import type { CredentialKind } from '@ssh-launchpad/shared'

export interface BrowserCredential { kind: CredentialKind; value: string }

const STORAGE_KEY = 'ssh-launchpad.browser-credentials.v1'

function readAll(): Record<string, BrowserCredential> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, BrowserCredential>
  } catch { return {} }
}

function writeAll(value: Record<string, BrowserCredential>): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) }

export const browserCredentials = {
  get(serverId: string): BrowserCredential | undefined { return readAll()[serverId] },
  set(serverId: string, credential: BrowserCredential): void { const values = readAll(); values[serverId] = credential; writeAll(values) },
  remove(serverId: string): void { const values = readAll(); delete values[serverId]; writeAll(values) },
}
