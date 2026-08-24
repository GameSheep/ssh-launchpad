import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'

describe('SSE route', () => {
  it('is registered on the local API', async () => {
    const app = await buildApp({ servers: { list: () => [], importConfig: () => ({ hosts: [], warnings: [] }), create: async () => { throw new Error() }, update: async () => { throw new Error() }, setCredential: async () => { throw new Error() }, deleteCredential: async () => { throw new Error() }, remove: async () => undefined }, serverConnections: { test: async () => ({ ok: true }), confirmFingerprint: () => { throw new Error() } }, apps: { list: () => [] } as never, runtime: {} as never, icons: {} as never, events: { publish: async () => undefined, subscribe: () => () => undefined, snapshot: () => ({}) }, sessionToken: 'token', allowedPort: 45680 })
    expect(app.hasRoute({ method: 'GET', url: '/api/events' })).toBe(true)
    await app.close()
  })
})
