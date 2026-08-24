import { describe, expect, it } from 'vitest'
import type { RemoteAppRecord, ServerRecord } from '@ssh-launchpad/shared'
import type { AppRepository } from '../db/app-repository.js'
import type { ServerRepository } from '../db/server-repository.js'
import type { SessionLease, SessionPool, SshSession } from '../ssh/ssh-session.js'
import type { PortReservation, TunnelHandle, TunnelManager } from '../tunnels/tunnel-manager.js'
import { InMemoryRuntimeEventBus } from './event-bus.js'
import { AppRuntimeServiceImpl } from './app-runtime-service.js'

const server: ServerRecord = { id: 's', name: 's', source: 'manual', host: '127.0.0.1', port: 22, username: 'u', authType: 'password', notes: '', createdAt: '', updatedAt: '' }
const app: RemoteAppRecord = { id: 'a', serverId: 's', name: 'DSH', type: 'dsh', remoteHost: '127.0.0.1', remotePort: 3080, localPort: 13080, protocol: 'http', healthPath: '/', autoStart: true, startCommand: 'run', stopOnDisconnect: true, stopCommand: 'stop', iconKind: 'letter', iconValue: 'DS', startTimeoutMs: 1000, healthTimeoutMs: 1000, createdAt: '', updatedAt: '' }

describe('AppRuntimeServiceImpl', () => {
  it('runs checking → connecting → starting → tunneling → healthy', async () => {
    const statuses: string[] = []; const events = new InMemoryRuntimeEventBus(); events.subscribe((event) => { if (event.type === 'runtime') statuses.push(event.snapshot.status) })
    let probes = 0
    const session: SshSession = { probe: async () => { probes += 1; return probes > 1 }, openForward: async () => { throw new Error() }, exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), execDetached: async () => ({ pid: 1, logPath: '' }), onDisconnect: () => () => undefined, close: async () => undefined }
    const lease: SessionLease = { session, release: async () => undefined }; const reservation: PortReservation = { appId: 'a', localPort: 13080, activate: async () => ({ localPort: 13080, close: async () => undefined }), release: async () => undefined }
    const deps = { apps: { get: () => app } as unknown as AppRepository, servers: { get: () => server } as unknown as ServerRepository, sessions: { acquire: async () => lease, closeAll: async () => undefined } as SessionPool, tunnels: { reserve: async () => reservation, get: () => undefined, close: async () => undefined, closeAll: async () => undefined } as TunnelManager, events, logs: { append: async () => undefined, read: async () => [] }, health: { check: async () => undefined } }
    const service = new AppRuntimeServiceImpl(deps)
    const result = await service.connect('a')
    expect(result.url).toBe('http://127.0.0.1:13080/')
    expect(statuses).toEqual(['checking', 'connecting', 'starting', 'tunneling', 'healthy'])
  })
})
