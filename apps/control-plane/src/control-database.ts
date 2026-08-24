import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface ControlDatabase {
  raw: DatabaseSync
  close(): void
}

export function openControlDatabase(path: string): ControlDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const raw = new DatabaseSync(path)
  raw.exec('PRAGMA foreign_keys = ON;')
  raw.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pairing_codes (
      code_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      used_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      paired_at TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0, 1))
    ) STRICT;
  `)
  return { raw, close: () => raw.close() }
}
