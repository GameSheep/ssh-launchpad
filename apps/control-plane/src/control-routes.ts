import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { LaunchpadError, remoteAppInputSchema, serverInputSchema, type ApiErrorBody, type AgentMethod, type CredentialKind, type RemoteAppInput, type ServerInput } from '@ssh-launchpad/shared'
import { AgentRegistry } from './agents/agent-registry.js'
import { PairingService } from './agents/pairing-service.js'
import type { SessionService } from './auth/session-service.js'
import { ControlEventBus } from './control-events.js'

export interface ControlRouteDependencies {
  sessions: SessionService
  registry: AgentRegistry
  pairing: PairingService
  events: ControlEventBus
  publicBaseUrl: string
}

function body(request: FastifyRequest): Record<string, unknown> { return (request.body ?? {}) as Record<string, unknown> }
function params(request: FastifyRequest): { id: string } { return request.params as { id: string } }
function credential(value: unknown): { kind: CredentialKind; value: string } | undefined {
  if (!value) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LaunchpadError('VALIDATION_FAILED', 'Invalid credential payload')
  const data = value as Record<string, unknown>
  if ((data.kind !== 'password' && data.kind !== 'private-key-passphrase') || typeof data.value !== 'string' || !data.value) throw new LaunchpadError('VALIDATION_FAILED', 'Invalid credential payload')
  return { kind: data.kind, value: data.value }
}

function session(request: FastifyRequest, dependencies: ControlRouteDependencies): void {
  if (!dependencies.sessions.verify(request.cookies.launchpad_session)) throw new LaunchpadError('SESSION_INVALID', 'Sign in to the control plane')
}

function selectedAgent(request: FastifyRequest, dependencies: ControlRouteDependencies, requested?: string): string {
  const query = request.query as { agentId?: string } | undefined
  const id = requested ?? query?.agentId
  const candidates = dependencies.registry.list()
  if (id) {
    const match = candidates.find((agent) => agent.id === id)
    if (!match || !match.connected) throw new LaunchpadError('AGENT_OFFLINE', 'The selected Agent is offline', { agentId: id })
    return id
  }
  const online = candidates.find((agent) => agent.connected)
  if (!online) throw new LaunchpadError('AGENT_OFFLINE', 'Start an Agent to use the workspace')
  return online.id
}

async function call(request: FastifyRequest, dependencies: ControlRouteDependencies, method: AgentMethod, payload: unknown, requested?: string): Promise<unknown> {
  return dependencies.registry.request(selectedAgent(request, dependencies, requested), method, payload)
}

function publicAppUrl(base: string, agentId: string, appId: string): string {
  return `${base.replace(/\/$/, '')}/tunnel/${encodeURIComponent(agentId)}/${encodeURIComponent(appId)}/`
}

async function connect(request: FastifyRequest, dependencies: ControlRouteDependencies, reconnect = false): Promise<{ url: string; status: 'healthy' }> {
  const agentId = selectedAgent(request, dependencies)
  const result = await dependencies.registry.request(agentId, reconnect ? 'apps.reconnect' : 'apps.connect', { id: params(request).id }) as { status: 'healthy'; url?: string }
  return { status: result.status, url: publicAppUrl(dependencies.publicBaseUrl, agentId, params(request).id) }
}

export async function registerControlRoutes(app: FastifyInstance, dependencies: ControlRouteDependencies): Promise<void> {
  app.post('/api/session', async (request, reply) => {
    const token = body(request).token
    if (typeof token !== 'string' || !token) throw new LaunchpadError('SESSION_INVALID', 'Control token is required')
    const value = dependencies.sessions.exchange(token)
    reply.setCookie('launchpad_session', value, { httpOnly: true, sameSite: 'strict', secure: dependencies.publicBaseUrl.startsWith('https://'), path: '/', maxAge: 30 * 24 * 60 * 60 })
    return { ok: true }
  })

  app.get('/api/control/status', async (request) => { session(request, dependencies); return { authenticated: true, agents: dependencies.registry.list() } })
  app.get('/api/agents', async (request) => { session(request, dependencies); return dependencies.registry.list() })
  app.post('/api/agents/pairing-codes', async (request) => { session(request, dependencies); return dependencies.pairing.create() })

  app.get('/api/bootstrap', async (request) => { session(request, dependencies); return call(request, dependencies, 'bootstrap', {}) })
  app.get('/api/servers', async (request) => { session(request, dependencies); return call(request, dependencies, 'servers.list', {}) })
  app.post('/api/servers', async (request) => { session(request, dependencies); const value = body(request); return call(request, dependencies, 'servers.create', { server: serverInputSchema.parse(value.server ?? value) as ServerInput, ...(credential(value.credential) ? { credential: credential(value.credential) } : {}) }) })
  app.patch('/api/servers/:id', async (request) => { session(request, dependencies); const value = body(request); return call(request, dependencies, 'servers.update', { id: params(request).id, server: serverInputSchema.parse(value.server ?? value) as ServerInput, ...(credential(value.credential) ? { credential: credential(value.credential) } : {}) }) })
  app.delete('/api/servers/:id', async (request) => { session(request, dependencies); await call(request, dependencies, 'servers.remove', { id: params(request).id }); return { ok: true } })
  app.post('/api/servers/:id/test', async (request) => { session(request, dependencies); return call(request, dependencies, 'servers.test', { id: params(request).id }) })
  app.post('/api/servers/:id/confirm-fingerprint', async (request) => { session(request, dependencies); const value = body(request).candidateFingerprint; if (typeof value !== 'string' || !value) throw new LaunchpadError('VALIDATION_FAILED', 'candidateFingerprint is required'); return call(request, dependencies, 'servers.confirmFingerprint', { id: params(request).id, candidateFingerprint: value }) })
  app.post('/api/servers/import-ssh-config', async (request) => { session(request, dependencies); const value = body(request).text; if (typeof value !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'SSH config text is required'); return call(request, dependencies, 'servers.importSshConfig', { text: value }) })
  app.put('/api/servers/:id/credential', async (request) => { session(request, dependencies); const value = credential(body(request)); if (!value) throw new LaunchpadError('VALIDATION_FAILED', 'Credential is required'); return call(request, dependencies, 'servers.setCredential', { id: params(request).id, credential: value }) })
  app.delete('/api/servers/:id/credential', async (request) => { session(request, dependencies); return call(request, dependencies, 'servers.deleteCredential', { id: params(request).id }) })

  app.get('/api/apps', async (request) => { session(request, dependencies); return call(request, dependencies, 'apps.list', {}) })
  app.post('/api/apps', async (request) => { session(request, dependencies); const value = body(request); return call(request, dependencies, 'apps.create', { app: remoteAppInputSchema.parse(value.app ?? value) as RemoteAppInput }) })
  app.patch('/api/apps/:id', async (request) => { session(request, dependencies); const value = body(request); return call(request, dependencies, 'apps.update', { id: params(request).id, app: remoteAppInputSchema.parse(value.app ?? value) as RemoteAppInput }) })
  app.delete('/api/apps/:id', async (request) => { session(request, dependencies); await call(request, dependencies, 'apps.remove', { id: params(request).id }); return { ok: true } })
  app.post('/api/apps/:id/connect', async (request) => { session(request, dependencies); return connect(request, dependencies) })
  app.post('/api/apps/:id/reconnect', async (request) => { session(request, dependencies); return connect(request, dependencies, true) })
  app.post('/api/apps/:id/disconnect', async (request) => { session(request, dependencies); await call(request, dependencies, 'apps.disconnect', { id: params(request).id }); return { ok: true } })
  app.get('/api/apps/:id/logs', async (request) => { session(request, dependencies); return call(request, dependencies, 'apps.logs', { id: params(request).id }) })

  app.get('/api/events', async (request, reply) => {
    session(request, dependencies)
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    raw.write(`event: snapshot\ndata: ${JSON.stringify({ type: 'snapshot', snapshots: dependencies.events.snapshotsList() })}\n\n`)
    const unsubscribe = dependencies.events.subscribe((event) => raw.write(`event: ${event.type === 'runtime' ? 'runtime' : event.type}\ndata: ${JSON.stringify(event)}\n\n`))
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15_000)
    raw.on('close', () => { clearInterval(heartbeat); unsubscribe() })
  })

  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/tunnel/:agentId/:appId/*',
    handler: async (request, reply) => {
      session(request, dependencies)
      const route = request.params as { agentId: string; appId: string; '*': string }
      const incomingHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') incomingHeaders[key] = value
      }
      let bodyBase64: string | undefined
      if (request.body !== undefined && request.method !== 'GET' && request.method !== 'HEAD') {
        const raw = Buffer.isBuffer(request.body) ? request.body : typeof request.body === 'string' ? Buffer.from(request.body) : Buffer.from(JSON.stringify(request.body))
        if (raw.byteLength > 10 * 1024 * 1024) throw new LaunchpadError('TUNNEL_FAILED', 'Request body is larger than 10 MiB')
        bodyBase64 = raw.toString('base64')
      }
      const result = await dependencies.registry.request(route.agentId, 'apps.proxy', { id: route.appId, method: request.method, path: `/${route['*'] ?? ''}${request.url.includes('?') ? `?${request.url.split('?')[1]}` : ''}`, headers: incomingHeaders, ...(bodyBase64 ? { bodyBase64 } : {}) }) as { status: number; headers: Record<string, string>; bodyBase64: string }
      for (const [key, value] of Object.entries(result.headers)) reply.header(key, value)
      reply.code(result.status)
      return reply.send(Buffer.from(result.bodyBase64, 'base64'))
    },
  })
}

export function controlErrorHandler(error: unknown, _request: FastifyRequest, reply: FastifyReply): void {
  const launchpad = error instanceof LaunchpadError ? error : new LaunchpadError('INTERNAL_ERROR', 'Internal server error')
  const status = launchpad.code === 'SESSION_INVALID' ? 401 : launchpad.code === 'FORBIDDEN' ? 403 : launchpad.code === 'NOT_FOUND' ? 404 : launchpad.code === 'AGENT_OFFLINE' || launchpad.code === 'RESOURCE_BUSY' || launchpad.code === 'LOCAL_PORT_IN_USE' ? 409 : launchpad.code === 'INTERNAL_ERROR' ? 500 : 400
  const body: ApiErrorBody = { error: { code: launchpad.code, message: launchpad.message, ...(launchpad.details ? { details: launchpad.details } : {}) } }
  reply.code(status).send(body)
}
