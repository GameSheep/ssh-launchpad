import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'

describe('API routes', () => {
  it('returns a structured bootstrap response', async () => {
    const app = await buildApp({ servers: { list: () => [], importConfig: () => ({ hosts: [], warnings: [] }), create: async () => { throw new Error() }, update: async () => { throw new Error() }, setCredential: async () => { throw new Error() }, deleteCredential: async () => { throw new Error() }, remove: async () => undefined }, serverConnections: { test: async () => ({ ok: true }), confirmFingerprint: () => { throw new Error() } }, apps: { list: () => [] } as never, runtime: {} as never, icons: {} as never, events: { publish: async () => undefined, subscribe: () => () => undefined, snapshot: () => ({}) }, sessionToken: 'token', allowedPort: 45679 })
    const response = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: 'localhost:45679' } })
    expect(response.json()).toMatchObject({ servers: [], apps: [], runtime: [] })
    await app.close()
  })
})
