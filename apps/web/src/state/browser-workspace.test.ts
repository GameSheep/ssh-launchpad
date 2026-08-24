import { beforeEach, describe, expect, it } from 'vitest'
import type { RemoteAppInput, ServerInput } from '@ssh-launchpad/shared'
import { browserWorkspace } from './browser-workspace.js'

const serverInput: ServerInput = { name: 'GPU', source: 'manual', host: '10.0.0.2', port: 22, username: 'root', authType: 'password', notes: '' }

beforeEach(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
})

describe('browser workspace', () => {
  it('keeps records in browser storage and rejects local port conflicts', () => {
    const server = browserWorkspace.createServer(serverInput)
    const app = browserWorkspace.createApp({ serverId: server.id, name: 'DSH', type: 'dsh', remoteHost: '127.0.0.1', remotePort: 3080, localPort: 2233, protocol: 'http', healthPath: '/', autoStart: false, stopOnDisconnect: false, iconKind: 'letter', iconValue: 'DS', startTimeoutMs: 30000, healthTimeoutMs: 10000 })
    expect(browserWorkspace.read()).toEqual({ servers: [server], apps: [app] })
    const appInput = { ...app } as unknown as RemoteAppInput
    expect(() => browserWorkspace.createApp({ ...appInput, name: 'Other' })).toThrow('2233')
  })

  it('stores a confirmed host fingerprint with the server record', () => {
    const server = browserWorkspace.createServer(serverInput)
    const updated = browserWorkspace.updateServerFingerprint(server.id, 'SHA256:known')
    expect(updated.hostFingerprint).toBe('SHA256:known')
    expect(browserWorkspace.read().servers[0]?.hostFingerprint).toBe('SHA256:known')
  })
})
