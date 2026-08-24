import type { CredentialStore } from '../credentials/credential-store.js'
import type { ServerRecord } from '@ssh-launchpad/shared'
import type { SshSession, SshSessionFactory, SessionLease, SessionPool } from './ssh-session.js'

type Entry = { session: SshSession; leases: number; removeDisconnect: () => void }

export class DefaultSessionPool implements SessionPool {
  private readonly sessions = new Map<string, Entry>()

  constructor(private readonly factory: SshSessionFactory, private readonly credentials: CredentialStore) {}

  async acquire(server: ServerRecord): Promise<SessionLease> {
    let entry = this.sessions.get(server.id)
    if (!entry) {
      const secret = server.credentialId ? await this.credentials.get(server.credentialId) : undefined
      const session = await this.factory.connect(server, secret)
      entry = { session, leases: 0, removeDisconnect: () => undefined }
      entry.removeDisconnect = session.onDisconnect(() => {
        const current = this.sessions.get(server.id)
        if (current?.session === session) this.sessions.delete(server.id)
      })
      this.sessions.set(server.id, entry)
    }
    entry.leases += 1
    let released = false
    return {
      session: entry.session,
      release: async () => {
        if (released) return
        released = true
        const current = this.sessions.get(server.id)
        if (!current || current.session !== entry!.session) return
        current.leases -= 1
        if (current.leases <= 0) {
          this.sessions.delete(server.id)
          current.removeDisconnect()
          await current.session.close()
        }
      },
    }
  }

  async closeAll(): Promise<void> {
    const entries = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.all(entries.map(async (entry) => {
      entry.removeDisconnect()
      await entry.session.close()
    }))
  }
}
