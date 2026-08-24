import { readFile } from 'node:fs/promises'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { remoteAppInputSchema, serverInputSchema, type CredentialKind, type RemoteAppInput, type ServerInput } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { ServerService } from '../servers/server-service.js'
import type { ServerConnectionService } from '../ssh/server-connection-service.js'
import type { AppRepository } from '../db/app-repository.js'
import type { AppRuntimeService } from '../runtime/types.js'
import type { IconStore } from '../icons/icon-store.js'

export interface ApiRouteDependencies {
  servers: ServerService
  serverConnections: ServerConnectionService
  apps: AppRepository
  runtime: AppRuntimeService
  icons: IconStore
}

function body(request: FastifyRequest): Record<string, unknown> {
  return (request.body ?? {}) as Record<string, unknown>
}

function credential(value: unknown): { kind: CredentialKind; value: string } | undefined {
  if (!value) return undefined
  const data = value as Record<string, unknown>
  if ((data.kind !== 'password' && data.kind !== 'private-key-passphrase') || typeof data.value !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'Invalid credential payload')
  return { kind: data.kind, value: data.value }
}

export async function registerRoutes(app: FastifyInstance, dependencies: ApiRouteDependencies): Promise<void> {
  app.get('/api/bootstrap', async (_request, reply) => {
    if (!reply.hasHeader('set-cookie')) reply.setCookie('launchpad_session', (app as FastifyInstance & { sessionToken?: string }).sessionToken ?? '', { httpOnly: true, sameSite: 'strict', path: '/' })
    const servers = dependencies.servers.list()
    return { servers, apps: dependencies.apps.list(), runtime: [] }
  })
  app.get('/api/servers', async () => dependencies.servers.list())
  app.post('/api/servers', async (request) => {
    const data = body(request)
    const server = serverInputSchema.parse(data.server ?? data) as ServerInput
    return dependencies.servers.create(server, credential(data.credential))
  })
  app.patch('/api/servers/:id', async (request) => {
    const data = body(request); const server = serverInputSchema.parse(data.server ?? data) as ServerInput
    return dependencies.servers.update((request.params as { id: string }).id, server, credential(data.credential))
  })
  app.delete('/api/servers/:id', async (request) => { await dependencies.servers.remove((request.params as { id: string }).id); return { ok: true } })
  app.post('/api/servers/:id/test', async (request) => dependencies.serverConnections.test((request.params as { id: string }).id))
  app.post('/api/servers/:id/confirm-fingerprint', async (request) => {
    const value = body(request).candidateFingerprint
    if (typeof value !== 'string' || !value) throw new LaunchpadError('VALIDATION_FAILED', 'candidateFingerprint is required')
    return dependencies.serverConnections.confirmFingerprint((request.params as { id: string }).id, value)
  })
  app.post('/api/servers/import-ssh-config', async (request) => {
    const text = body(request).text
    if (typeof text !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'SSH config text is required')
    return dependencies.servers.importConfig(text)
  })
  app.put('/api/servers/:id/credential', async (request) => {
    const secret = credential(body(request))
    if (!secret) throw new LaunchpadError('VALIDATION_FAILED', 'Credential is required')
    return dependencies.servers.setCredential((request.params as { id: string }).id, secret)
  })
  app.delete('/api/servers/:id/credential', async (request) => dependencies.servers.deleteCredential((request.params as { id: string }).id))

  app.get('/api/apps', async (request) => dependencies.apps.list((request.query as { serverId?: string }).serverId))
  app.post('/api/apps', async (request) => dependencies.apps.create(remoteAppInputSchema.parse(body(request).app ?? body(request)) as RemoteAppInput))
  app.patch('/api/apps/:id', async (request) => dependencies.apps.update((request.params as { id: string }).id, remoteAppInputSchema.parse(body(request).app ?? body(request)) as RemoteAppInput))
  app.delete('/api/apps/:id', async (request) => { const id = (request.params as { id: string }).id; dependencies.apps.delete(id); return { ok: true } })
  app.post('/api/apps/:id/connect', async (request) => dependencies.runtime.connect((request.params as { id: string }).id))
  app.post('/api/apps/:id/disconnect', async (request) => { await dependencies.runtime.disconnect((request.params as { id: string }).id); return { ok: true } })
  app.post('/api/apps/:id/reconnect', async (request) => dependencies.runtime.reconnect((request.params as { id: string }).id))
  app.get('/api/apps/:id/logs', async (request) => dependencies.runtime.getLogs((request.params as { id: string }).id))

  app.post('/api/icons', async (request) => {
    const data = body(request)
    if (typeof data.mimeType !== 'string' || typeof data.dataBase64 !== 'string') throw new LaunchpadError('VALIDATION_FAILED', 'mimeType and dataBase64 are required')
    let bytes: Buffer
    try { bytes = Buffer.from(data.dataBase64, 'base64') } catch { throw new LaunchpadError('VALIDATION_FAILED', 'Invalid base64 icon data') }
    const icon = await dependencies.icons.save(data.mimeType, bytes)
    return { id: icon.id, mimeType: icon.mimeType }
  })
  app.get('/api/icons/:id', async (request, reply) => {
    const icon = await dependencies.icons.get((request.params as { id: string }).id)
    if (!icon) throw new LaunchpadError('NOT_FOUND', 'Icon was not found')
    reply.type(icon.mimeType).send(await readFile(icon.path))
  })
}
