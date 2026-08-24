import type { CredentialKind, ServerRecord } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { CredentialStore } from '../credentials/credential-store.js'
import type { ServerRepository } from '../db/server-repository.js'
import type { SshSessionFactory } from './ssh-session.js'

export interface ServerConnectionService {
  test(serverId: string): Promise<{ ok: true } | { ok: false; candidateFingerprint: string }>
  confirmFingerprint(serverId: string, candidateFingerprint: string): ServerRecord
}

export class DefaultServerConnectionService implements ServerConnectionService {
  private readonly candidates = new Map<string, string>()

  constructor(
    private readonly servers: ServerRepository,
    private readonly credentials: CredentialStore,
    private readonly factory: SshSessionFactory,
  ) {}

  async test(serverId: string): Promise<{ ok: true } | { ok: false; candidateFingerprint: string }> {
    const server = this.servers.get(serverId)
    if (!server) throw new LaunchpadError('NOT_FOUND', `Server ${serverId} was not found`, { resource: 'server', id: serverId })
    const secret = server.credentialId ? await this.credentials.get(server.credentialId) : undefined
    try {
      const session = await this.factory.connect(server, secret)
      await session.close()
      this.candidates.delete(serverId)
      return { ok: true }
    } catch (error) {
      if (error instanceof LaunchpadError && error.code === 'SSH_HOST_KEY_UNKNOWN') {
        const candidate = String(error.details?.candidateFingerprint ?? '')
        if (!candidate) throw error
        this.candidates.set(serverId, candidate)
        return { ok: false, candidateFingerprint: candidate }
      }
      throw error
    }
  }

  confirmFingerprint(serverId: string, candidateFingerprint: string): ServerRecord {
    const expected = this.candidates.get(serverId)
    if (!expected || expected !== candidateFingerprint) {
      throw new LaunchpadError('FORBIDDEN', 'Fingerprint confirmation is no longer valid')
    }
    const updated = this.servers.setFingerprint(serverId, candidateFingerprint)
    this.candidates.delete(serverId)
    return updated
  }
}

export type { CredentialKind }
