import type { RemoteAppRecord, RuntimeSnapshot, ServerRecord } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { AppRepository } from '../db/app-repository.js'
import type { ServerRepository } from '../db/server-repository.js'
import type { SessionLease, SessionPool } from '../ssh/ssh-session.js'
import type { PortReservation, TunnelHandle, TunnelManager } from '../tunnels/tunnel-manager.js'
import type { AppRuntimeService, ConnectResult, HealthChecker, LogStore, RuntimeEventBus } from './types.js'

type RuntimeEntry = {
  app: RemoteAppRecord
  server: ServerRecord
  lease: SessionLease
  reservation: PortReservation
  tunnel?: TunnelHandle
  startedByLaunchpad: boolean
  removeDisconnect: () => void
}

function snapshot(appId: string, status: RuntimeSnapshot['status'], error?: LaunchpadError): RuntimeSnapshot {
  const value: RuntimeSnapshot = { appId, status, startedByLaunchpad: false, updatedAt: new Date().toISOString() }
  if (error) { value.errorCode = error.code; value.errorMessage = error.message }
  return value
}

export interface RuntimeDependencies {
  apps: AppRepository
  servers: ServerRepository
  sessions: SessionPool
  tunnels: TunnelManager
  events: RuntimeEventBus
  logs: LogStore
  health: HealthChecker
}

export class AppRuntimeServiceImpl implements AppRuntimeService {
  private readonly active = new Map<string, RuntimeEntry>()
  private readonly inFlight = new Map<string, Promise<ConnectResult>>()

  constructor(private readonly dependencies: RuntimeDependencies) {}

  async connect(appId: string): Promise<ConnectResult> {
    const existing = this.inFlight.get(appId)
    if (existing) return existing
    const promise = this.connectInternal(appId)
    this.inFlight.set(appId, promise)
    try { return await promise } finally { this.inFlight.delete(appId) }
  }

  async reconnect(appId: string): Promise<ConnectResult> {
    await this.disconnect(appId)
    return this.connect(appId)
  }

  async disconnect(appId: string): Promise<void> {
    const entry = this.active.get(appId)
    if (!entry) return
    this.active.delete(appId)
    entry.removeDisconnect()
    if (entry.startedByLaunchpad && entry.app.stopOnDisconnect && entry.app.stopCommand) {
      await entry.lease.session.exec(entry.app.stopCommand, entry.app.startTimeoutMs).catch(() => undefined)
    }
    await entry.tunnel?.close().catch(() => undefined)
    await entry.reservation.release().catch(() => undefined)
    await entry.lease.release().catch(() => undefined)
    await this.publish(snapshot(appId, 'disconnected'))
  }

  async getLogs(appId: string): Promise<string[]> {
    return this.dependencies.logs.read(appId, 200)
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.active.keys()].map((appId) => this.disconnect(appId)))
    await this.dependencies.tunnels.closeAll()
    await this.dependencies.sessions.closeAll()
  }

  private async connectInternal(appId: string): Promise<ConnectResult> {
    const app = this.dependencies.apps.get(appId)
    if (!app) throw new LaunchpadError('NOT_FOUND', `Application ${appId} was not found`, { resource: 'app', id: appId })
    const server = this.dependencies.servers.get(app.serverId)
    if (!server) throw new LaunchpadError('NOT_FOUND', `Server ${app.serverId} was not found`, { resource: 'server', id: app.serverId })
    await this.publish(snapshot(appId, 'checking'))
    let reservation: PortReservation | undefined
    let lease: SessionLease | undefined
    let tunnel: TunnelHandle | undefined
    let startedByLaunchpad = false
    try {
      reservation = await this.dependencies.tunnels.reserve(app.id, app.localPort)
      await this.publish(snapshot(appId, 'connecting'))
      lease = await this.dependencies.sessions.acquire(server)
      let open = await lease.session.probe(app.remoteHost, app.remotePort)
      if (!open) {
        if (!app.autoStart || !app.startCommand) throw new LaunchpadError('REMOTE_PORT_CLOSED', 'Remote application port is closed')
        await this.publish(snapshot(appId, 'starting'))
        const startInput = { appId: app.id, command: app.startCommand, timeoutMs: app.startTimeoutMs, ...(app.workingDirectory ? { workingDirectory: app.workingDirectory } : {}) }
        await lease.session.execDetached(startInput)
        startedByLaunchpad = true
        const deadline = Date.now() + app.startTimeoutMs
        while (!open && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 150))
          open = await lease!.session.probe(app.remoteHost, app.remotePort)
        }
        if (!open) throw new LaunchpadError('REMOTE_START_TIMEOUT', 'Remote application did not open its port in time')
      }
      await this.publish(snapshot(appId, 'tunneling'))
      tunnel = await reservation.activate(lease.session, app.remoteHost, app.remotePort)
      const url = `${app.protocol}://127.0.0.1:${app.localPort}${app.healthPath}`
      await this.dependencies.health.check(url, app.healthTimeoutMs)
      const entry: RuntimeEntry = { app, server, lease, reservation, tunnel, startedByLaunchpad, removeDisconnect: () => undefined }
      entry.removeDisconnect = lease.session.onDisconnect(() => { void this.handleUnexpectedDisconnect(appId) })
      this.active.set(appId, entry)
      await this.publish({ ...snapshot(appId, 'healthy'), startedByLaunchpad })
      return { url, status: 'healthy' }
    } catch (error) {
      await tunnel?.close().catch(() => undefined)
      await reservation?.release().catch(() => undefined)
      await lease?.release().catch(() => undefined)
      const failure = error instanceof LaunchpadError ? error : new LaunchpadError('INTERNAL_ERROR', 'Application connection failed')
      await this.publish(snapshot(appId, 'error', failure))
      throw failure
    }
  }

  private async handleUnexpectedDisconnect(appId: string): Promise<void> {
    if (!this.active.has(appId)) return
    this.active.delete(appId)
    for (const delay of [1000, 3000, 10000]) {
      await this.publish(snapshot(appId, 'connecting'))
      await new Promise((resolve) => setTimeout(resolve, delay))
      try {
        await this.connect(appId)
        return
      } catch { /* retry at the next backoff */ }
    }
    await this.publish(snapshot(appId, 'error', new LaunchpadError('SSH_CONNECTION_FAILED', 'SSH connection was lost')))
  }

  private publish(value: RuntimeSnapshot): Promise<void> {
    return this.dependencies.events.publish({ type: 'runtime', snapshot: value })
  }
}

export { AppRuntimeServiceImpl as DefaultAppRuntimeService }
