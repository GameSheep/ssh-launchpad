import { describe, expect, it } from 'vitest'
import { openDatabase } from './db/database.js'
import { SqliteAppRepository } from './db/app-repository.js'
import { SqliteServerRepository } from './db/server-repository.js'
import { buildLocalBridge } from './local-bridge.js'

describe('local SSH bridge', () => {
  it('syncs public records and returns the configured localhost URL', async () => {
    const database = openDatabase(':memory:')
    const servers = new SqliteServerRepository(database)
    const apps = new SqliteAppRepository(database)
    const events = { publish: async () => undefined, subscribe: () => () => undefined, snapshot: () => ({}), snapshotsList: () => [] }
    const runtime = { connect: async () => ({ status: 'healthy' as const, url: 'http://127.0.0.1:13080/' }), reconnect: async () => ({ status: 'healthy' as const, url: 'http://127.0.0.1:13080/' }), disconnect: async () => undefined, getLogs: async () => [], shutdown: async () => undefined }
    const serverConnections = { test: async () => ({ ok: true as const }), confirmFingerprint: () => { throw new Error() }, rememberCandidate: () => undefined }
    const bridge = await buildLocalBridge({ servers, apps, serverConnections, runtime, events, allowedOrigins: ['https://tyyun.haibao.fun'] })
    const preflight = await bridge.inject({ method: 'OPTIONS', url: '/api/connect', headers: { origin: 'https://tyyun.haibao.fun', 'access-control-request-method': 'POST' } })
    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('https://tyyun.haibao.fun')
    const server = { id: 'server-1', name: 'GPU', source: 'manual', host: '10.0.0.2', port: 22, username: 'root', authType: 'password', notes: '', createdAt: 'now', updatedAt: 'now' }
    const app = { id: 'app-1', serverId: 'server-1', name: 'DeepSeek Harness', type: 'dsh', remoteHost: '127.0.0.1', remotePort: 3080, localPort: 13080, protocol: 'http', healthPath: '/', autoStart: false, stopOnDisconnect: false, iconKind: 'letter', iconValue: 'DS', startTimeoutMs: 30000, healthTimeoutMs: 10000, createdAt: 'now', updatedAt: 'now' }
    const response = await bridge.inject({ method: 'POST', url: '/api/connect', headers: { origin: 'https://tyyun.haibao.fun', 'content-type': 'application/json' }, payload: JSON.stringify({ server, app, credential: { kind: 'password', value: 'secret' } }) })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ url: 'http://127.0.0.1:13080/', status: 'healthy' })
    expect(servers.get('server-1')?.host).toBe('10.0.0.2')
    expect(apps.get('app-1')?.localPort).toBe(13080)
    await bridge.close(); database.close()
  })
})
