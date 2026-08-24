import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { ControlDatabase } from '../control-database.js'

const SESSION_DAYS = 30

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface SessionService {
  exchange(controlToken: string): string
  verify(sessionToken: string | undefined): boolean
  revoke(sessionToken: string): void
}

export class SqliteSessionService implements SessionService {
  constructor(private readonly database: ControlDatabase, private readonly expectedToken: string) {}

  exchange(controlToken: string): string {
    const expected = Buffer.from(this.expectedToken)
    const received = Buffer.from(controlToken)
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new LaunchpadError('SESSION_INVALID', 'Control token is invalid')
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString()
    this.database.raw.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(hash(token), expiresAt)
    return token
  }

  verify(sessionToken: string | undefined): boolean {
    if (!sessionToken) return false
    const row = this.database.raw.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hash(sessionToken)) as { expires_at: string } | undefined
    if (!row) return false
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.database.raw.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(sessionToken))
      return false
    }
    return true
  }

  revoke(sessionToken: string): void {
    this.database.raw.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash(sessionToken))
  }
}
