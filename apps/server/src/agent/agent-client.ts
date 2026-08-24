import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import WebSocket from 'ws'
import { LaunchpadError, parseAgentMessage, type AgentEventMessage, type AgentFailureResponse, type AgentHelloMessage, type AgentMessage, type AgentPairedMessage, type AgentRequest, type AgentSuccessResponse } from '@ssh-launchpad/shared'
import { AgentRpcHandler } from './agent-rpc-handler.js'

interface AgentClientOptions {
  controlUrl: string
  pairingCode?: string
  agentName: string
  tokenPath: string
  handler: AgentRpcHandler
}

interface TokenFile { agentId: string; token: string }

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)) }

export class AgentClient {
  private socket: WebSocket | undefined
  private stopped = false
  private token: TokenFile | undefined
  private firstConnected!: { promise: Promise<void>; resolve: () => void }

  constructor(private readonly options: AgentClientOptions) {
    let resolve!: () => void
    this.firstConnected = { promise: new Promise<void>((done) => { resolve = done }), resolve }
  }

  async start(): Promise<void> {
    this.token = await this.loadToken()
    void this.runLoop()
    await this.firstConnected.promise
  }

  async stop(): Promise<void> { this.stopped = true; this.socket?.close() }

  publishEvent(event: AgentEventMessage['event']): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'event', event }))
  }

  private async runLoop(): Promise<void> {
    let delay = 1000
    while (!this.stopped) {
      try { await this.openConnection(); delay = 1000 } catch { if (this.stopped) return; await sleep(delay); delay = Math.min(delay * 3, 10_000) }
    }
  }

  private openConnection(): Promise<void> {
    const url = this.options.controlUrl.replace(/^http/, 'ws').replace(/\/$/, '') + '/agent'
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url); this.socket = socket
      let handshaken = false
      const close = () => { if (!handshaken) reject(new LaunchpadError('AGENT_OFFLINE', 'Control plane connection closed during handshake')); else resolve() }
      socket.once('open', () => {
        if (this.token) {
          const hello: AgentHelloMessage = { type: 'hello', agentId: this.token.agentId, token: this.token.token, name: this.options.agentName }
          socket.send(JSON.stringify(hello))
        } else if (this.options.pairingCode) {
          socket.send(JSON.stringify({ type: 'pair', code: this.options.pairingCode, name: this.options.agentName }))
        } else {
          socket.close(); reject(new LaunchpadError('PAIRING_INVALID', 'PAIRING_CODE is required for first Agent start'))
        }
      })
      socket.on('message', (raw) => { void this.handleMessage(raw.toString(), () => { handshaken = true; resolve(); this.firstConnected.resolve() }) })
      socket.once('error', (error) => { if (!handshaken) reject(error) })
      socket.once('close', close)
    })
  }

  private async handleMessage(raw: string, onHandshake: () => void): Promise<void> {
    let rawValue: { type?: string; error?: { code?: string } }
    try { rawValue = JSON.parse(raw) as { type?: string; error?: { code?: string } } } catch { this.socket?.close(); return }
    if (rawValue.type === 'error') {
      if (rawValue.error?.code === 'PAIRING_INVALID' && this.options.pairingCode) {
        this.token = undefined
        await unlink(this.options.tokenPath).catch(() => undefined)
      }
      this.socket?.close()
      return
    }
    let message: AgentMessage
    try { message = parseAgentMessage(rawValue) } catch { this.socket?.close(); return }
    if (message.type === 'paired') {
      const paired: AgentPairedMessage = message; this.token = { agentId: paired.agentId, token: paired.token }; await this.saveToken(this.token); onHandshake(); return
    }
    if (message.type === 'request') {
      const request: AgentRequest = message
      try {
        const result = await this.options.handler.handle(request.method, request.payload)
        const response: AgentSuccessResponse = { type: 'response', id: request.id, ok: true, result }
        this.socket?.send(JSON.stringify(response))
      } catch (error) {
        const launchpad = error instanceof LaunchpadError ? error : new LaunchpadError('INTERNAL_ERROR', 'Agent operation failed')
        const response: AgentFailureResponse = { type: 'response', id: request.id, ok: false, error: { code: launchpad.code, message: launchpad.message, ...(launchpad.details ? { details: launchpad.details } : {}) } }
        this.socket?.send(JSON.stringify(response))
      }
    }
  }

  private async loadToken(): Promise<TokenFile | undefined> { try { return JSON.parse(await readFile(this.options.tokenPath, 'utf8')) as TokenFile } catch { return undefined } }
  private async saveToken(token: TokenFile): Promise<void> { await mkdir(dirname(this.options.tokenPath), { recursive: true }); await writeFile(this.options.tokenPath, JSON.stringify(token), { encoding: 'utf8', mode: 0o600 }) }
}

export type { AgentClientOptions }
