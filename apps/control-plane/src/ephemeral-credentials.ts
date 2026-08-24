import { LaunchpadError, type CredentialKind } from '@ssh-launchpad/shared'
import type { CredentialStore } from '@ssh-launchpad/server'

/**
 * Browser-only credential bridge. Values live only in this process memory and
 * are removed after each test/connect operation; nothing is persisted.
 */
export class EphemeralCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>()

  async set(serverId: string, kind: CredentialKind, secret: string): Promise<string> {
    if (!secret) throw new LaunchpadError('VALIDATION_FAILED', 'Credential value is required')
    const id = `${serverId}:${kind}`
    this.values.set(id, secret)
    return id
  }

  async get(credentialId: string): Promise<string> {
    const value = this.values.get(credentialId)
    if (!value) throw new LaunchpadError('CREDENTIAL_UNAVAILABLE', 'Enter the SSH credential in this browser before connecting')
    return value
  }

  async delete(credentialId: string): Promise<void> { this.values.delete(credentialId) }
  clearServer(serverId: string): void { for (const key of this.values.keys()) if (key.startsWith(`${serverId}:`)) this.values.delete(key) }
}
