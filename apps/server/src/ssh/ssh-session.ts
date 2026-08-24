import { readFile } from 'node:fs/promises'
import type { Client, ClientChannel, ConnectConfig } from 'ssh2'
import { Client as Ssh2Client } from 'ssh2'
import type { ServerRecord } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'
import { buildDetachedCommand } from './posix-command.js'

const MAX_OUTPUT = 64 * 1024

export interface ExecResult { stdout: string; stderr: string; exitCode: number | null }
export interface DetachedProcess { pid: number; logPath: string }

export interface SshSession {
  probe(remoteHost: string, remotePort: number): Promise<boolean>
  openForward(remoteHost: string, remotePort: number): Promise<NodeJS.ReadWriteStream>
  exec(command: string, timeoutMs: number): Promise<ExecResult>
  execDetached(input: { appId: string; workingDirectory?: string; command: string; timeoutMs: number }): Promise<DetachedProcess>
  onDisconnect(listener: (error?: Error) => void): () => void
  close(): Promise<void>
}

export interface SshSessionFactory {
  connect(server: ServerRecord, secret?: string): Promise<SshSession>
}

export interface SessionLease { session: SshSession; release(): Promise<void> }
export interface SessionPool { acquire(server: ServerRecord): Promise<SessionLease>; closeAll(): Promise<void> }

function mapConnectionError(error: unknown, candidate: string | undefined, expected: string | undefined): LaunchpadError {
  const message = error instanceof Error ? error.message : String(error)
  if (candidate && !expected) return new LaunchpadError('SSH_HOST_KEY_UNKNOWN', 'Host key has not been confirmed', { candidateFingerprint: candidate })
  if (candidate && expected && candidate !== expected) return new LaunchpadError('SSH_HOST_KEY_CHANGED', 'Host key does not match the saved fingerprint')
  if (/authentication|configured authentication methods failed|all configured/i.test(message)) {
    return new LaunchpadError('SSH_AUTH_FAILED', 'SSH authentication failed')
  }
  if (/timed out|timeout/i.test(message)) return new LaunchpadError('SSH_CONNECTION_FAILED', 'SSH connection timed out')
  return new LaunchpadError('SSH_CONNECTION_FAILED', 'SSH connection failed')
}

export class Ssh2Session implements SshSession {
  private readonly disconnectListeners = new Set<(error?: Error) => void>()
  private closed = false

  private constructor(private readonly client: Client) {
    client.on('error', (error) => this.notifyDisconnect(error))
    client.on('end', () => this.notifyDisconnect())
    client.on('close', () => this.notifyDisconnect())
  }

  static async connect(server: ServerRecord, secret?: string): Promise<Ssh2Session> {
    const client = new Ssh2Client()
    let candidate: string | undefined
    const config: ConnectConfig = {
      host: server.host,
      port: server.port,
      username: server.username,
      readyTimeout: 15_000,
      hostHash: 'sha256',
      hostVerifier: (fingerprint: string) => {
        candidate = fingerprint
        return server.hostFingerprint ? fingerprint === server.hostFingerprint : false
      },
    }
    try {
      if (server.authType === 'password' && secret) config.password = secret
      if (server.authType === 'private-key') {
        if (!server.privateKeyPath) throw new LaunchpadError('VALIDATION_FAILED', 'Private key path is required')
        config.privateKey = await readFile(server.privateKeyPath)
        if (secret) config.passphrase = secret
      }
      if (server.authType === 'ssh-config') {
        // SSH Config import stores the resolved host/user/port. Agent support
        // remains available through the SSH_AUTH_SOCK environment variable.
        const agent = process.env.SSH_AUTH_SOCK
        if (agent) config.agent = agent
        else if (secret) config.password = secret
      }
      await new Promise<void>((resolve, reject) => {
        const onReady = () => { cleanup(); resolve() }
        const onError = (error: Error) => { cleanup(); reject(error) }
        const cleanup = () => {
          client.off('ready', onReady)
          client.off('error', onError)
        }
        client.once('ready', onReady)
        client.once('error', onError)
        client.connect(config)
      })
      return new Ssh2Session(client)
    } catch (error) {
      client.destroy()
      if (error instanceof LaunchpadError) throw error
      throw mapConnectionError(error, candidate, server.hostFingerprint)
    }
  }

  async probe(remoteHost: string, remotePort: number): Promise<boolean> {
    try {
      const stream = await this.openForward(remoteHost, remotePort)
      ;(stream as unknown as { destroy(): void }).destroy()
      return true
    } catch (error) {
      if (error instanceof LaunchpadError && error.code === 'REMOTE_PORT_CLOSED') return false
      return false
    }
  }

  openForward(remoteHost: string, remotePort: number): Promise<NodeJS.ReadWriteStream> {
    return new Promise((resolve, reject) => {
      this.client.forwardOut('127.0.0.1', 0, remoteHost, remotePort, (error, stream) => {
        if (error || !stream) {
          reject(new LaunchpadError('REMOTE_PORT_CLOSED', `Remote port ${remoteHost}:${remotePort} is unavailable`, { remoteHost, remotePort }))
          return
        }
        resolve(stream as unknown as NodeJS.ReadWriteStream)
      })
    })
  }

  exec(command: string, timeoutMs: number): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      let channel: ClientChannel | undefined
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        channel?.destroy()
        reject(new LaunchpadError('SSH_CONNECTION_FAILED', 'Remote command timed out'))
      }, timeoutMs)
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(new LaunchpadError('SSH_CONNECTION_FAILED', 'Remote command failed'))
        else resolve({ stdout, stderr, exitCode: exitCodeValue })
      }
      let exitCodeValue: number | null = null
      this.client.exec(command, (error, createdChannel) => {
        if (error || !createdChannel) { finish(error ?? new Error('No SSH channel')); return }
        channel = createdChannel
        createdChannel.on('data', (chunk: Buffer) => { if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8').slice(0, MAX_OUTPUT - stdout.length) })
        createdChannel.stderr.on('data', (chunk: Buffer) => { if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8').slice(0, MAX_OUTPUT - stderr.length) })
        createdChannel.on('exit', (code) => { exitCodeValue = typeof code === 'number' ? code : null })
        createdChannel.on('close', () => finish())
        createdChannel.on('error', (channelError: Error) => finish(channelError))
      })
    })
  }

  async execDetached(input: { appId: string; workingDirectory?: string; command: string; timeoutMs: number }): Promise<DetachedProcess> {
    const built = buildDetachedCommand(input)
    const result = await this.exec(built.command, input.timeoutMs)
    const pid = Number(result.stdout.trim().split(/\s+/)[0])
    if (!Number.isInteger(pid) || pid <= 0) throw new LaunchpadError('REMOTE_START_FAILED', 'Remote process did not return a PID')
    return { pid, logPath: built.logPath }
  }

  onDisconnect(listener: (error?: Error) => void): () => void {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.client.end()
  }

  private notifyDisconnect(error?: Error): void {
    for (const listener of this.disconnectListeners) listener(error)
  }
}

export class DefaultSshSessionFactory implements SshSessionFactory {
  connect(server: ServerRecord, secret?: string): Promise<SshSession> {
    return Ssh2Session.connect(server, secret)
  }
}
