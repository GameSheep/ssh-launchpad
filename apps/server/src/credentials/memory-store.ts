import { randomUUID } from 'node:crypto'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { CredentialKind, CredentialStore } from './credential-store.js'

/** Request-scoped/local-helper storage. It is never written to disk. */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>()

  async set(serverId: string, kind: CredentialKind, secret: string): Promise<string> {
    const id = `${serverId}:${kind}:${randomUUID()}`
    this.values.set(id, secret)
    return id
  }

  async get(credentialId: string): Promise<string> {
    const value = this.values.get(credentialId)
    if (value === undefined) throw new LaunchpadError('CREDENTIAL_UNAVAILABLE', 'Credential is not available in this process')
    return value
  }

  async delete(credentialId: string): Promise<void> { this.values.delete(credentialId) }
}
