import { describe, expect, it } from 'vitest'
import type { RemoteAppInput, ServerInput } from '@ssh-launchpad/shared'
import { openDatabase } from './database.js'
import { SqliteAppRepository } from './app-repository.js'
import { SqliteServerRepository } from './server-repository.js'

const serverInput = (name: string): ServerInput => ({
  name, source: 'manual', host: '127.0.0.1', port: 22, username: 'root', authType: 'password', notes: '',
})

const appInput = (serverId: string, localPort: number): RemoteAppInput => ({
  serverId, name: 'DSH', type: 'dsh', remoteHost: '127.0.0.1', remotePort: 3080,
  localPort, protocol: 'http', healthPath: '/', autoStart: false, stopOnDisconnect: false,
  iconKind: 'letter', iconValue: 'DS', startTimeoutMs: 30_000, healthTimeoutMs: 10_000,
})

describe('SQLite repositories', () => {
  it('persists server and app records with optional values', () => {
    const db = openDatabase(':memory:')
    const servers = new SqliteServerRepository(db)
    const apps = new SqliteAppRepository(db)
    const server = servers.create(serverInput('GPU'), 'gpu-password')
    const app = apps.create(appInput(server.id, 13080))
    expect(servers.get(server.id)?.credentialId).toBe('gpu-password')
    expect(apps.get(app.id)?.localPort).toBe(13080)
    apps.delete(app.id)
    servers.delete(server.id)
    expect(servers.list()).toHaveLength(0)
    db.close()
  })

  it('rejects duplicate local ports across different servers', () => {
    const db = openDatabase(':memory:')
    const servers = new SqliteServerRepository(db)
    const apps = new SqliteAppRepository(db)
    const firstServer = servers.create(serverInput('GPU'))
    const secondServer = servers.create(serverInput('Cloud'))
    apps.create(appInput(firstServer.id, 13080))
    expect(() => apps.create(appInput(secondServer.id, 13080)))
      .toThrowError(expect.objectContaining({ code: 'LOCAL_PORT_IN_USE' }))
    db.close()
  })

  it('protects a server that still owns applications', () => {
    const db = openDatabase(':memory:')
    const servers = new SqliteServerRepository(db)
    const apps = new SqliteAppRepository(db)
    const server = servers.create(serverInput('GPU'))
    apps.create(appInput(server.id, 13080))
    expect(() => servers.delete(server.id)).toThrowError(expect.objectContaining({ code: 'RESOURCE_BUSY' }))
    db.close()
  })
})
