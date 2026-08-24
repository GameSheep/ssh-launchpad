import { describe, expect, it } from 'vitest'
import { LaunchpadError } from '@ssh-launchpad/shared'
import { SERVICE_NAME, WindowsCredentialStore } from './keyring-store.js'

type FakeEntry = {
  secret: string | null
  setPassword(value: string): void
  getPassword(): string | null
  deletePassword(): boolean
}

function fakeKeyring() {
  const entries = new Map<string, FakeEntry>()
  const factory = (service: string, account: string): FakeEntry => {
    expect(service).toBe(SERVICE_NAME)
    let entry = entries.get(account)
    if (!entry) {
      entry = {
        secret: null,
        setPassword(value) { this.secret = value },
        getPassword() { return this.secret },
        deletePassword() { this.secret = null; return true },
      }
      entries.set(account, entry)
    }
    return entry
  }
  return { entries, factory }
}

describe('WindowsCredentialStore', () => {
  it('stores, reads and deletes by a stable server/kind id', async () => {
    const keyring = fakeKeyring()
    const store = new WindowsCredentialStore(keyring.factory)

    const id = await store.set('server-a', 'password', 'not-logged')
    expect(id).toBe('server-a:password')
    expect(await store.get(id)).toBe('not-logged')
    expect([...keyring.entries.keys()]).toEqual(['server-a:password'])

    await store.delete(id)
    await expect(store.get(id)).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' })
  })

  it('does not expose native keyring errors or secrets', async () => {
    const store = new WindowsCredentialStore(() => {
      throw new Error('native failure with secret password=top-secret')
    })

    await expect(store.get('server-a:password')).rejects.toSatisfy((error: unknown) => {
      return error instanceof LaunchpadError
        && error.code === 'CREDENTIAL_UNAVAILABLE'
        && error.message === 'Windows Credential Manager is unavailable'
        && !error.message.includes('top-secret')
    })
  })
})
