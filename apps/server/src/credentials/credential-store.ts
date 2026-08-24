export type CredentialKind = 'password' | 'private-key-passphrase'

/**
 * Secret storage is deliberately kept behind this small interface so the rest
 * of the server never needs to know which operating-system credential store is
 * being used.
 */
export interface CredentialStore {
  set(serverId: string, kind: CredentialKind, secret: string): Promise<string>
  get(credentialId: string): Promise<string>
  delete(credentialId: string): Promise<void>
}
