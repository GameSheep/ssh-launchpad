import { remoteAppInputSchema, serverInputSchema, type CredentialKind, type RemoteAppInput, type ServerInput } from '@ssh-launchpad/shared'
import { LaunchpadError, type AgentMethod } from '@ssh-launchpad/shared'
import type { AppRepository } from '../db/app-repository.js'
import type { CredentialStore } from '../credentials/credential-store.js'
import type { ServerRepository } from '../db/server-repository.js'
import type { ServerService } from '../servers/server-service.js'
import type { ServerConnectionService } from '../ssh/server-connection-service.js'
import type { AppRuntimeService } from '../runtime/types.js'
import type { RuntimeEventBus, LogStore } from '../runtime/types.js'
import { proxyLocalApp } from './http-proxy.js'

interface Dependencies {
  servers: ServerService
  serverRepository: ServerRepository
  serverConnections: ServerConnectionService
  apps: AppRepository
  runtime: AppRuntimeService
  events: RuntimeEventBus
  logs: LogStore
  credentials: CredentialStore
}

function data(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new LaunchpadError('VALIDATION_FAILED', 'Agent payload must be an object')
  return payload as Record<string, unknown>
}

function id(payload: unknown): string {
  const value = data(payload).id
  if (typeof value !== 'string' || !value) throw new LaunchpadError('VALIDATION_FAILED', 'A resource id is required')
  return value
}

function secret(payload: unknown): { kind: CredentialKind; value: string } {
  const value = data(payload).credential as Record<string, unknown> | undefined
  if (!value || (value.kind !== 'password' && value.kind !== 'private-key-passphrase') || typeof value.value !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'A valid credential is required')
  return { kind: value.kind, value: value.value }
}

export class AgentRpcHandler {
  constructor(private readonly dependencies: Dependencies) {}

  async handle(method: AgentMethod, payload: unknown): Promise<unknown> {
    const { servers, serverRepository, serverConnections, apps, runtime } = this.dependencies
    if (method === 'bootstrap') {
      return { servers: servers.list(), apps: apps.list(), runtime: this.dependencies.events.snapshotsList?.() ?? [] }
    }
    if (method === 'servers.list') return servers.list()
    if (method === 'servers.create') {
      const value = data(payload); const input = serverInputSchema.parse(value.server ?? value) as ServerInput
      const credential = value.credential ? secret({ credential: value.credential }) : undefined
      return servers.create(input, credential)
    }
    if (method === 'servers.update') {
      const value = data(payload); const input = serverInputSchema.parse(value.server ?? value) as ServerInput
      const credential = value.credential ? secret({ credential: value.credential }) : undefined
      return servers.update(id(payload), input, credential)
    }
    if (method === 'servers.remove') return servers.remove(id(payload))
    if (method === 'servers.importSshConfig') {
      const value = data(payload)
      if (typeof value.text !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'SSH config text is required')
      return servers.importConfig(value.text)
    }
    if (method === 'servers.test') return serverConnections.test(id(payload))
    if (method === 'servers.confirmFingerprint') {
      const value = data(payload); if (typeof value.candidateFingerprint !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'Fingerprint is required')
      return serverConnections.confirmFingerprint(id(payload), value.candidateFingerprint)
    }
    if (method === 'servers.setCredential') return servers.setCredential(id(payload), secret(payload))
    if (method === 'servers.deleteCredential') return servers.deleteCredential(id(payload))
    if (method === 'apps.list') return apps.list()
    if (method === 'apps.create') return apps.create(remoteAppInputSchema.parse(data(payload).app ?? payload) as RemoteAppInput)
    if (method === 'apps.update') return apps.update(id(payload), remoteAppInputSchema.parse(data(payload).app ?? payload) as RemoteAppInput)
    if (method === 'apps.remove') { apps.delete(id(payload)); return { ok: true } }
    if (method === 'apps.connect') {
      try { return await runtime.connect(id(payload)) } catch (error) {
        if (error instanceof LaunchpadError && error.code === 'SSH_HOST_KEY_UNKNOWN') {
          const app = apps.get(id(payload)); const candidate = error.details?.candidateFingerprint
          if (app && typeof candidate === 'string') serverConnections.rememberCandidate?.(app.serverId, candidate)
        }
        throw error
      }
    }
    if (method === 'apps.disconnect') { await runtime.disconnect(id(payload)); return { ok: true } }
    if (method === 'apps.reconnect') { return runtime.reconnect(id(payload)) }
    if (method === 'apps.logs') return runtime.getLogs(id(payload))
    if (method === 'apps.proxy') {
      const value = data(payload); const app = apps.get(id(payload)); if (!app) throw new LaunchpadError('NOT_FOUND', 'Application was not found')
      const headers = value.headers && typeof value.headers === 'object' ? value.headers as Record<string, string> : {}
      return proxyLocalApp({ app, method: typeof value.method === 'string' ? value.method : 'GET', path: typeof value.path === 'string' ? value.path : '/', headers, ...(typeof value.bodyBase64 === 'string' ? { bodyBase64: value.bodyBase64 } : {}) })
    }
    void serverRepository
    void this.dependencies.credentials
    throw new LaunchpadError('VALIDATION_FAILED', `Unsupported Agent method: ${method}`)
  }
}
