import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { LaunchpadError, remoteAppInputSchema, serverInputSchema, type ApiErrorBody, type CredentialKind, type RemoteAppInput, type RemoteAppRecord, type ServerInput, type ServerRecord } from '@ssh-launchpad/shared'
import type { AppRuntimeService, RuntimeEventBus } from './runtime/types.js'
import type { AppRepository } from './db/app-repository.js'
import type { ServerRepository } from './db/server-repository.js'
import type { ServerConnectionService } from './ssh/server-connection-service.js'

export interface LocalBridgeDependencies {
  servers: ServerRepository
  apps: AppRepository
  serverConnections: ServerConnectionService
  runtime: AppRuntimeService
  events: RuntimeEventBus
  allowedOrigins: string[]
}

function body(request: FastifyRequest): Record<string, unknown> { return (request.body ?? {}) as Record<string, unknown> }

function credential(value: unknown): { kind: CredentialKind; value: string } | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new LaunchpadError('VALIDATION_FAILED', 'Invalid credential payload')
  const data = value as Record<string, unknown>
  if ((data.kind !== 'password' && data.kind !== 'private-key-passphrase') || typeof data.value !== 'string' || !data.value) throw new LaunchpadError('VALIDATION_FAILED', 'Invalid credential payload')
  return { kind: data.kind, value: data.value }
}

function serverRecord(value: unknown): { id: string; input: ServerInput; hostFingerprint?: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LaunchpadError('VALIDATION_FAILED', 'Server configuration is required')
  const data = value as Record<string, unknown>
  if (typeof data.id !== 'string' || !data.id) throw new LaunchpadError('VALIDATION_FAILED', 'Server id is required')
  const input = serverInputSchema.parse(data) as ServerInput
  return { id: data.id, input, ...(typeof data.hostFingerprint === 'string' && data.hostFingerprint ? { hostFingerprint: data.hostFingerprint } : {}) }
}

function appRecord(value: unknown): { id: string; input: RemoteAppInput } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LaunchpadError('VALIDATION_FAILED', 'Application configuration is required')
  const data = value as Record<string, unknown>
  if (typeof data.id !== 'string' || !data.id) throw new LaunchpadError('VALIDATION_FAILED', 'Application id is required')
  return { id: data.id, input: remoteAppInputSchema.parse(data) as RemoteAppInput }
}

function syncRecords(dependencies: LocalBridgeDependencies, server: { id: string; input: ServerInput; hostFingerprint?: string }, application: { id: string; input: RemoteAppInput }): void {
  const existingServer = dependencies.servers.get(server.id)
  if (existingServer) dependencies.servers.update(server.id, server.input, null)
  else dependencies.servers.create(server.input, null, server.id)
  if (server.hostFingerprint && existingServer?.hostFingerprint !== server.hostFingerprint) dependencies.servers.setFingerprint(server.id, server.hostFingerprint)

  if (dependencies.apps.get(application.id)) dependencies.apps.update(application.id, application.input)
  else dependencies.apps.create(application.input, application.id)
}

async function connect(request: FastifyRequest, dependencies: LocalBridgeDependencies, reconnect = false): Promise<{ url: string; status: 'healthy' }> {
  const value = body(request)
  const server = serverRecord(value.server)
  const application = appRecord(value.app)
  if (application.input.serverId !== server.id) throw new LaunchpadError('VALIDATION_FAILED', 'Application and server do not match')
  syncRecords(dependencies, server, application)
  const secret = credential(value.credential)?.value
  try {
    const result = reconnect ? await dependencies.runtime.reconnect(application.id, secret) : await dependencies.runtime.connect(application.id, secret)
    return { url: result.url, status: result.status }
  } catch (error) {
    if (error instanceof LaunchpadError && error.code === 'SSH_HOST_KEY_UNKNOWN') {
      const candidate = error.details?.candidateFingerprint
      if (typeof candidate === 'string' && candidate) dependencies.serverConnections.rememberCandidate?.(server.id, candidate)
    }
    throw error
  }
}

function errorStatus(error: LaunchpadError): number {
  if (error.code === 'NOT_FOUND') return 404
  if (error.code === 'FORBIDDEN') return 403
  if (error.code === 'RESOURCE_BUSY' || error.code === 'LOCAL_PORT_IN_USE') return 409
  if (error.code === 'INTERNAL_ERROR') return 500
  return 400
}

export async function buildLocalBridge(dependencies: LocalBridgeDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  const allowed = new Set(dependencies.allowedOrigins.filter(Boolean))
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin && !allowed.has(origin)) throw new LaunchpadError('FORBIDDEN', 'Local bridge origin is not allowed')
    if (origin) reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin')
    reply.header('Access-Control-Allow-Private-Network', 'true')
    if (request.method === 'OPTIONS') return reply.code(204).header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS').header('Access-Control-Allow-Headers', 'Content-Type').send()
  })
  app.setErrorHandler((error, _request, reply: FastifyReply) => {
    const launchpad = error instanceof LaunchpadError ? error : new LaunchpadError('INTERNAL_ERROR', 'Local SSH bridge failed')
    const response: ApiErrorBody = { error: { code: launchpad.code, message: launchpad.message, ...(launchpad.details ? { details: launchpad.details } : {}) } }
    reply.code(errorStatus(launchpad)).send(response)
  })
  app.get('/health', async () => ({ ok: true, mode: 'local-ssh' }))
  app.get('/api/runtime', async () => dependencies.events.snapshotsList?.() ?? [])
  app.post('/api/connect', async (request) => connect(request, dependencies))
  app.post('/api/reconnect', async (request) => connect(request, dependencies, true))
  app.post('/api/disconnect', async (request) => {
    const id = body(request).appId
    if (typeof id !== 'string' || !id) throw new LaunchpadError('VALIDATION_FAILED', 'Application id is required')
    await dependencies.runtime.disconnect(id)
    return { ok: true }
  })
  app.post('/api/confirm-fingerprint', async (request) => {
    const value = body(request)
    if (typeof value.serverId !== 'string' || !value.serverId || typeof value.candidateFingerprint !== 'string' || !value.candidateFingerprint) throw new LaunchpadError('VALIDATION_FAILED', 'Server id and candidate fingerprint are required')
    return dependencies.serverConnections.confirmFingerprint(value.serverId, value.candidateFingerprint)
  })
  return app
}

export type { RemoteAppRecord, ServerRecord }
