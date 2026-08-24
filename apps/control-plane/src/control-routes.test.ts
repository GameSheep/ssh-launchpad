import { describe, expect, it, vi } from 'vitest'
import { LaunchpadError, type RemoteAppRecord } from '@ssh-launchpad/shared'
import { buildControlApp } from './control-app.js'
import { EphemeralCredentialStore } from './ephemeral-credentials.js'

const appRecord: RemoteAppRecord = {
  id: 'app-1', serverId: 'server-1', name: 'DeepSeek Harness', type: 'dsh', remoteHost: '127.0.0.1', remotePort: 3080, localPort: 13080, protocol: 'http', healthPath: '/', autoStart: false, stopOnDisconnect: false, iconKind: 'letter', iconValue: 'DS', startTimeoutMs: 30000, healthTimeoutMs: 10000, createdAt: 'now', updatedAt: 'now',
}

describe('single-server control routes', () => {
  it('does not return workspace records from the control plane', async () => {
    const app = await buildControlApp({
      publicBaseUrl: 'http://127.0.0.1:4318',
      sessions: { verify: () => true, exchange: () => 'session', revoke: () => undefined },
      servers: { list: () => [{ id: 'server-1' } as never], create: async () => { throw new Error() }, update: async () => { throw new Error() }, setCredential: async () => { throw new Error() }, deleteCredential: async () => { throw new Error() }, remove: async () => undefined, importConfig: () => ({ hosts: [], warnings: [] }) },
      serverConnections: { test: async () => ({ ok: true }), confirmFingerprint: () => { throw new Error() }, rememberCandidate: () => undefined },
      apps: { list: () => [appRecord], get: () => appRecord, create: () => { throw new Error() }, update: () => { throw new Error() }, delete: () => undefined, findByLocalPort: () => undefined },
      runtime: { connect: async () => ({ status: 'healthy', url: '' }), reconnect: async () => ({ status: 'healthy', url: '' }), disconnect: async () => undefined, getLogs: async () => [], shutdown: async () => undefined },
      events: { publish: async () => undefined, subscribe: () => () => undefined, snapshot: () => ({}), snapshotsList: () => [] },
      credentials: new EphemeralCredentialStore(),
    })

    const response = await app.inject({ method: 'GET', url: '/api/bootstrap', headers: { host: '127.0.0.1:4318', cookie: 'launchpad_session=valid' } })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ servers: [], apps: [], runtime: [] })
    await app.close()
  })

  it('remembers an unknown host fingerprint thrown by runtime connect', async () => {
    const rememberCandidate = vi.fn()
    const app = await buildControlApp({
      publicBaseUrl: 'http://127.0.0.1:4318',
      sessions: { verify: () => true, exchange: () => 'session', revoke: () => undefined },
      servers: { list: () => [], create: async () => { throw new Error() }, update: async () => { throw new Error() }, setCredential: async () => { throw new Error() }, deleteCredential: async () => { throw new Error() }, remove: async () => undefined, importConfig: () => ({ hosts: [], warnings: [] }) },
      serverConnections: { test: async () => ({ ok: true }), confirmFingerprint: () => { throw new Error() }, rememberCandidate },
      apps: { list: () => [appRecord], get: (id) => id === appRecord.id ? appRecord : undefined, create: () => { throw new Error() }, update: () => { throw new Error() }, delete: () => undefined, findByLocalPort: () => undefined },
      runtime: { connect: async () => { throw new LaunchpadError('SSH_HOST_KEY_UNKNOWN', 'Host key has not been confirmed', { candidateFingerprint: 'SHA256:new' }) }, reconnect: async () => ({ status: 'healthy', url: '' }), disconnect: async () => undefined, getLogs: async () => [], shutdown: async () => undefined },
      events: { publish: async () => undefined, subscribe: () => () => undefined, snapshot: () => ({}), snapshotsList: () => [] },
      credentials: new EphemeralCredentialStore(),
    })

    const response = await app.inject({ method: 'POST', url: '/api/apps/app-1/connect', headers: { host: '127.0.0.1:4318', cookie: 'launchpad_session=valid', 'content-type': 'application/json' }, payload: '{}' })
    expect(response.statusCode).toBe(400)
    expect(rememberCandidate).toHaveBeenCalledWith('server-1', 'SHA256:new')
    await app.close()
  })
})
