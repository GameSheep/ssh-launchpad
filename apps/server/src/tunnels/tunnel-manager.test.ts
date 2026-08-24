import { PassThrough } from 'node:stream'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { DefaultTunnelManager } from './tunnel-manager.js'
import type { SshSession } from '../ssh/ssh-session.js'

function fakeSession(): SshSession {
  return {
    probe: async () => true,
    openForward: async () => new PassThrough() as unknown as NodeJS.ReadWriteStream,
    exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    execDetached: async () => ({ pid: 1, logPath: '' }),
    onDisconnect: () => () => undefined,
    close: async () => undefined,
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port
      server.close(() => resolve(port))
    })
  })
}

describe('DefaultTunnelManager', () => {
  it('reserves a port and rejects duplicate reservations/conflicts', async () => {
    const manager = new DefaultTunnelManager()
    const port = await freePort()
    const first = await manager.reserve('one', port)
    await expect(manager.reserve('one', port + 1)).rejects.toMatchObject({ code: 'RESOURCE_BUSY' })
    await expect(manager.reserve('two', port)).rejects.toMatchObject({ code: 'LOCAL_PORT_IN_USE' })
    await first.release()
    const again = await manager.reserve('two', port)
    await again.release()
  })

  it('forwards a local connection through the SSH stream', async () => {
    const manager = new DefaultTunnelManager()
    const port = await freePort()
    const reservation = await manager.reserve('one', port)
    const session = fakeSession()
    await reservation.activate(session, '127.0.0.1', 8080)
    expect(manager.get('one')?.localPort).toBe(port)
    await manager.close('one')
    expect(manager.get('one')).toBeUndefined()
  })
})
