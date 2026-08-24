import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'

function deps() {
  const empty = { list: () => [], importConfig: () => ({ hosts: [], warnings: [] }), create: async () => { throw new Error() }, update: async () => { throw new Error() }, setCredential: async () => { throw new Error() }, deleteCredential: async () => { throw new Error() }, remove: async () => undefined }
  return { servers: empty, serverConnections: { test: async () => ({ ok: true as const }), confirmFingerprint: () => { throw new Error() } }, apps: { list: () => [] } as never, runtime: { connect: async () => ({ url: '', status: 'healthy' as const }), disconnect: async () => undefined, reconnect: async () => ({ url: '', status: 'healthy' as const }), getLogs: async () => [], shutdown: async () => undefined } as never, icons: { save: async () => ({ id: '', mimeType: 'image/png' as const, path: '' }), get: async () => undefined, delete: async () => undefined }, events: { publish: async () => undefined, subscribe: () => () => undefined, snapshot: () => ({}) }, sessionToken: 'token', allowedPort: 45678 }
}

describe('API security', () => {
  it('allows local bootstrap, but protects mutations and rejects foreign hosts', async () => {
    const app = await buildApp(deps())
    const bootstrap = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: '127.0.0.1:45678' } })
    expect(bootstrap.statusCode).toBe(200)
    const cookie = bootstrap.headers['set-cookie']
    const mutation = await app.inject({ method: 'POST', url: '/api/servers', headers: { host: '127.0.0.1:45678', cookie: cookie as string, 'content-type': 'application/json' }, payload: {} })
    expect(mutation.statusCode).not.toBe(403)
    const foreign = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'evil.example' } })
    expect(foreign.statusCode).toBe(403)
    await app.close()
  })
})
