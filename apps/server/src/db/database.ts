import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface LaunchpadDatabase {
  raw: DatabaseSync
  close(): void
}

const migrations = [
  `
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      config_alias TEXT,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      private_key_path TEXT,
      credential_id TEXT,
      host_fingerprint TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS remote_apps (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      remote_host TEXT NOT NULL,
      remote_port INTEGER NOT NULL,
      local_port INTEGER NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      health_path TEXT NOT NULL,
      auto_start INTEGER NOT NULL CHECK (auto_start IN (0, 1)),
      working_directory TEXT,
      start_command TEXT,
      stop_on_disconnect INTEGER NOT NULL CHECK (stop_on_disconnect IN (0, 1)),
      stop_command TEXT,
      icon_kind TEXT NOT NULL,
      icon_value TEXT NOT NULL,
      start_timeout_ms INTEGER NOT NULL,
      health_timeout_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `,
]

export function openDatabase(path: string): LaunchpadDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const raw = new DatabaseSync(path)
  raw.exec('PRAGMA foreign_keys = ON;')
  const version = Number(raw.prepare('PRAGMA user_version').get()?.user_version ?? 0)
  if (version < migrations.length) {
    raw.exec('BEGIN IMMEDIATE')
    try {
      for (let index = version; index < migrations.length; index += 1) {
        raw.exec(migrations[index]!)
        raw.exec(`PRAGMA user_version = ${index + 1}`)
      }
      raw.exec('COMMIT')
    } catch (error) {
      raw.exec('ROLLBACK')
      raw.close()
      throw error
    }
  }
  return { raw, close: () => raw.close() }
}
