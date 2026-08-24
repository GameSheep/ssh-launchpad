import { createHash, randomBytes } from 'node:crypto'
import { LaunchpadError, type AgentDescriptor } from '@ssh-launchpad/shared'
import type { ControlDatabase } from '../control-database.js'
import { AgentRegistry } from './agent-registry.js'

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }

export interface PairingCode { code: string; expiresAt: string }

export class PairingService {
  constructor(private readonly database: ControlDatabase, private readonly registry: AgentRegistry) {}

  create(): PairingCode {
    const code = randomBytes(4).toString('hex').toUpperCase().slice(0, 6)
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
    this.database.raw.prepare('INSERT INTO pairing_codes (code_hash, expires_at, used_at) VALUES (?, ?, NULL)').run(hash(code), expiresAt)
    return { code, expiresAt }
  }

  consume(code: string, name: string): { descriptor: AgentDescriptor; token: string } {
    const row = this.database.raw.prepare('SELECT code_hash, expires_at, used_at FROM pairing_codes WHERE code_hash = ?').get(hash(code)) as { code_hash: string; expires_at: string; used_at: string | null } | undefined
    if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) throw new LaunchpadError('PAIRING_INVALID', 'Pairing code is invalid or expired')
    this.database.raw.prepare('UPDATE pairing_codes SET used_at = ? WHERE code_hash = ?').run(new Date().toISOString(), row.code_hash)
    return this.registry.create(name.trim() || 'Unnamed Agent')
  }
}
