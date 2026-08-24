import { describe, expect, it } from 'vitest'
import type { ServerRecord } from '@ssh-launchpad/shared'
import type { CredentialStore } from '../credentials/credential-store.js'
import { DefaultSessionPool } from './session-pool.js'
import type { SshSession, SshSessionFactory } from './ssh-session.js'

const server: ServerRecord = { id: 's1', name: 'one', source: 'manual', host: 'localhost', port: 22, username: 'u', authType: 'password', notes: '', createdAt: '', updatedAt: '' }

function fakeSession() {
  const listeners = new Set<(error?: Error) => void>()
  let closes = 0
  const session: SshSession = {
    probe: async () => true, openForward: async () => { throw new Error() }, exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }), execDetached: async () => ({ pid: 1, logPath: '' }),
    onDisconnect: (listener) => { listeners.add(listener); return () => listeners.delete(listener) }, close: async () => { closes += 1 },
  }
  return { session, get closes() { return closes }, disconnect: () => { for (const listener of listeners) listener(new Error('lost')) } }
}

describe('DefaultSessionPool', () => {
  it('shares, reference-counts and removes sessions', async () => {
    const fake = fakeSession(); let connects = 0
    const factory: SshSessionFactory = { connect: async () => { connects += 1; return fake.session } }
    const credentials: CredentialStore = { set: async () => '', get: async () => '', delete: async () => undefined }
    const pool = new DefaultSessionPool(factory, credentials)
    const one = await pool.acquire(server); const two = await pool.acquire(server)
    expect(connects).toBe(1); expect(one.session).toBe(two.session)
    await one.release(); expect(fake.closes).toBe(0)
    await two.release(); expect(fake.closes).toBe(1)
    const three = await pool.acquire(server); expect(connects).toBe(2); await three.release()
  })
})
