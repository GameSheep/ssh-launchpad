import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { LaunchpadError, remoteAppInputSchema, serverInputSchema, type ApiErrorBody, type CredentialKind, type RemoteAppInput, type ServerInput } from '@ssh-launchpad/shared'
import type { AppRepository, AppRuntimeService, RuntimeEventBus, ServerConnectionService, ServerService } from '@ssh-launchpad/server'
import { proxyLocalApp } from '@ssh-launchpad/server'
import type { SessionService } from './auth/session-service.js'
import { EphemeralCredentialStore } from './ephemeral-credentials.js'

export interface ControlRouteDependencies {
  sessions: SessionService
  servers: ServerService
  serverConnections: ServerConnectionService
  apps: AppRepository
  runtime: AppRuntimeService
  events: RuntimeEventBus
  credentials: EphemeralCredentialStore
  publicBaseUrl: string
}

function body(request: FastifyRequest): Record<string, unknown> { return (request.body ?? {}) as Record<string, unknown> }
function params(request: FastifyRequest): { id: string } { return request.params as { id: string } }
function credential(value: unknown): { kind: CredentialKind; value: string } | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) throw new LaunchpadError('VALIDATION_FAILED', 'Invalid credential payload')
  const data = value as Record<string, unknown>
  if ((data.kind !== 'password' && data.kind !== 'private-key-passphrase') || typeof data.value !== 'string' || !data.value) throw new LaunchpadError('VALIDATION_FAILED', 'Invalid credential payload')
  return { kind: data.kind, value: data.value }
}

function requireSession(request: FastifyRequest, dependencies: ControlRouteDependencies): void {
  if (!dependencies.sessions.verify(request.cookies.launchpad_session)) throw new LaunchpadError('SESSION_INVALID', 'Sign in to the control plane')
}

async function withCredential<T>(dependencies: ControlRouteDependencies, serverId: string, value: unknown, operation: (secret?: string) => Promise<T>): Promise<T> {
  const parsed = credential(value)
  if (!parsed) return operation()
  await dependencies.credentials.set(serverId, parsed.kind, parsed.value)
  try { return await operation(parsed.value) } finally { dependencies.credentials.clearServer(serverId) }
}

function publicAppUrl(base: string, appId: string): string { return `${base.replace(/\/$/, '')}/tunnel/${encodeURIComponent(appId)}/` }

async function connect(request: FastifyRequest, dependencies: ControlRouteDependencies, reconnect = false): Promise<{ url: string; status: 'healthy' }> {
  const appId = params(request).id
  const app = dependencies.apps.get(appId)
  if (!app) throw new LaunchpadError('NOT_FOUND', 'Application was not found')
  const result = await withCredential(dependencies, app.serverId, body(request).credential, (secret) => reconnect ? dependencies.runtime.reconnect(appId, secret) : dependencies.runtime.connect(appId, secret))
  return { url: publicAppUrl(dependencies.publicBaseUrl, appId), status: result.status }
}

export async function registerControlRoutes(app: FastifyInstance, dependencies: ControlRouteDependencies): Promise<void> {
  app.post('/api/session', async (request, reply) => {
    const token = body(request).token
    if (typeof token !== 'string' || !token) throw new LaunchpadError('SESSION_INVALID', 'Control token is required')
    const value = dependencies.sessions.exchange(token)
    reply.setCookie('launchpad_session', value, { httpOnly: true, sameSite: 'strict', secure: dependencies.publicBaseUrl.startsWith('https://'), path: '/', maxAge: 30 * 24 * 60 * 60 })
    return { ok: true }
  })

  app.get('/api/bootstrap', async (request) => { requireSession(request, dependencies); return { servers: dependencies.servers.list(), apps: dependencies.apps.list(), runtime: dependencies.events.snapshotsList?.() ?? [] } })
  app.get('/api/servers', async (request) => { requireSession(request, dependencies); return dependencies.servers.list() })
  app.post('/api/servers', async (request) => { requireSession(request, dependencies); const value = body(request); return dependencies.servers.create(serverInputSchema.parse(value.server ?? value) as ServerInput) })
  app.patch('/api/servers/:id', async (request) => { requireSession(request, dependencies); const value = body(request); return dependencies.servers.update(params(request).id, serverInputSchema.parse(value.server ?? value) as ServerInput) })
  app.delete('/api/servers/:id', async (request) => { requireSession(request, dependencies); await dependencies.servers.remove(params(request).id); return { ok: true } })
  app.post('/api/servers/:id/test', async (request) => { requireSession(request, dependencies); return withCredential(dependencies, params(request).id, body(request).credential, (secret) => dependencies.serverConnections.test(params(request).id, secret)) })
  app.post('/api/servers/:id/confirm-fingerprint', async (request) => { requireSession(request, dependencies); const value = body(request).candidateFingerprint; if (typeof value !== 'string' || !value) throw new LaunchpadError('VALIDATION_FAILED', 'candidateFingerprint is required'); return dependencies.serverConnections.confirmFingerprint(params(request).id, value) })
  app.post('/api/servers/import-ssh-config', async (request) => { requireSession(request, dependencies); const value = body(request).text; if (typeof value !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'SSH config text is required'); return dependencies.servers.importConfig(value) })
  app.get('/api/apps', async (request) => { requireSession(request, dependencies); return dependencies.apps.list() })
  app.post('/api/apps', async (request) => { requireSession(request, dependencies); const value = body(request); return dependencies.apps.create(remoteAppInputSchema.parse(value.app ?? value) as RemoteAppInput) })
  app.patch('/api/apps/:id', async (request) => { requireSession(request, dependencies); const value = body(request); return dependencies.apps.update(params(request).id, remoteAppInputSchema.parse(value.app ?? value) as RemoteAppInput) })
  app.delete('/api/apps/:id', async (request) => { requireSession(request, dependencies); dependencies.apps.delete(params(request).id); return { ok: true } })
  app.post('/api/apps/:id/connect', async (request) => { requireSession(request, dependencies); return connect(request, dependencies) })
  app.post('/api/apps/:id/reconnect', async (request) => { requireSession(request, dependencies); return connect(request, dependencies, true) })
  app.post('/api/apps/:id/disconnect', async (request) => { requireSession(request, dependencies); await dependencies.runtime.disconnect(params(request).id); const application = dependencies.apps.get(params(request).id); if (application) dependencies.credentials.clearServer(application.serverId); return { ok: true } })
  app.get('/api/apps/:id/logs', async (request) => { requireSession(request, dependencies); return dependencies.runtime.getLogs(params(request).id) })

  app.get('/api/events', async (request, reply) => {
    requireSession(request, dependencies)
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const initial = dependencies.events.snapshotsList?.() ?? []
    raw.write(`event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', snapshots: initial })}\n\n`)
    const unsubscribe = dependencies.events.subscribe((event) => raw.write(`event: ${event.type === 'runtime' ? 'runtime' : event.type}\ndata: ${JSON.stringify(event)}\n\n`))
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15_000)
    raw.on('close', () => { clearInterval(heartbeat); unsubscribe() })
  })

  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/tunnel/:appId/*',
    handler: async (request, reply) => {
      requireSession(request, dependencies)
      const route = request.params as { appId: string; '*': string }
      const application = dependencies.apps.get(route.appId)
      if (!application) throw new LaunchpadError('NOT_FOUND', 'Application was not found')
      const incomingHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') incomingHeaders[key] = value
      let bodyBase64: string | undefined
      if (request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD') {
        const rawBody = Buffer.isBuffer(request.body) ? request.body : typeof request.body === 'string' ? Buffer.from(request.body) : Buffer.from(JSON.stringify(request.body))
        if (rawBody.byteLength > 10 * 1024 * 1024) throw new LaunchpadError('TUNNEL_FAILED', 'Request body is larger than 10 MiB')
        bodyBase64 = rawBody.toString('base64')
      }
      const result = await proxyLocalApp({ app: application, method: request.method, path: `/${route['*'] ?? ''}${request.url.includes('?') ? `?${request.url.split('?')[1]}` : ''}`, headers: incomingHeaders, ...(bodyBase64 ? { bodyBase64 } : {}) })
      for (const [key, value] of Object.entries(result.headers)) reply.header(key, value)
      return reply.code(result.status).send(Buffer.from(result.bodyBase64, 'base64'))
    },
  })
}

export function controlErrorHandler(error: unknown, _request: FastifyRequest, reply: FastifyReply): void {
  const launchpad = error instanceof LaunchpadError ? error : new LaunchpadError('INTERNAL_ERROR', 'Internal server error')
  const status = launchpad.code === 'SESSION_INVALID' ? 401 : launchpad.code === 'FORBIDDEN' ? 403 : launchpad.code === 'NOT_FOUND' ? 404 : launchpad.code === 'RESOURCE_BUSY' || launchpad.code === 'LOCAL_PORT_IN_USE' ? 409 : launchpad.code === 'INTERNAL_ERROR' ? 500 : 400
  const body: ApiErrorBody = { error: { code: launchpad.code, message: launchpad.message, ...(launchpad.details ? { details: launchpad.details } : {}) } }
  reply.code(status).send(body)
}
