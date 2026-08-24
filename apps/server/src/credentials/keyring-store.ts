import { Entry } from '@napi-rs/keyring'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { CredentialKind, CredentialStore } from './credential-store.js'

const SERVICE_NAME = 'ssh-launchpad'

interface KeyringEntry {
  setPassword(password: string): void
  getPassword(): string | null | undefined
  deletePassword(): boolean | unknown
}

export type EntryFactory = (service: string, account: string) => KeyringEntry

function credentialId(serverId: string, kind: CredentialKind): string {
  return `${serverId}:${kind}`
}

function unavailable(operation: string): LaunchpadError {
  return new LaunchpadError(
    'CREDENTIAL_UNAVAILABLE',
    'Windows Credential Manager is unavailable',
    { operation },
  )
}

/** Windows Credential Manager backed implementation used by the API layer. */
export class WindowsCredentialStore implements CredentialStore {
  constructor(private readonly createEntry: EntryFactory = (service, account) => new Entry(service, account)) {}

  async set(serverId: string, kind: CredentialKind, secret: string): Promise<string> {
    const id = credentialId(serverId, kind)
    try {
      this.createEntry(SERVICE_NAME, id).setPassword(secret)
      return id
    } catch {
      throw unavailable('set')
    }
  }

  async get(id: string): Promise<string> {
    try {
      const value = this.createEntry(SERVICE_NAME, id).getPassword()
      if (!value) throw unavailable('get')
      return value
    } catch (error) {
      if (error instanceof LaunchpadError) throw error
      throw unavailable('get')
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.createEntry(SERVICE_NAME, id).deletePassword()
    } catch {
      // Deleting an already absent entry is intentionally idempotent. Native
      // keyring failures are still surfaced so the caller can show a useful
      // recovery action instead of silently losing state.
      throw unavailable('delete')
    }
  }
}

export { SERVICE_NAME }
