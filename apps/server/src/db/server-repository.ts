import { randomUUID } from 'node:crypto'
import type { ServerInput, ServerRecord } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { LaunchpadDatabase } from './database.js'

type ServerRow = {
  id: string
  name: string
  source: ServerRecord['source']
  config_alias: string | null
  host: string
  port: number
  username: string
  auth_type: ServerRecord['authType']
  private_key_path: string | null
  credential_id: string | null
  host_fingerprint: string | null
  notes: string
  created_at: string
  updated_at: string
}

export interface ServerRepository {
  list(): ServerRecord[]
  get(id: string): ServerRecord | undefined
  create(input: ServerInput, credentialId?: string | null, id?: string): ServerRecord
  update(id: string, input: ServerInput, credentialId?: string | null): ServerRecord
  setFingerprint(id: string, fingerprint: string): ServerRecord
  delete(id: string): void
}

function mapRow(row: ServerRow): ServerRecord {
  const record: ServerRecord = {
    id: row.id,
    name: row.name,
    source: row.source,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.config_alias !== null) record.configAlias = row.config_alias
  if (row.private_key_path !== null) record.privateKeyPath = row.private_key_path
  if (row.credential_id !== null) record.credentialId = row.credential_id
  if (row.host_fingerprint !== null) record.hostFingerprint = row.host_fingerprint
  return record
}

function notFound(id: string): never {
  throw new LaunchpadError('NOT_FOUND', `Server ${id} was not found`, { resource: 'server', id })
}

export class SqliteServerRepository implements ServerRepository {
  constructor(private readonly database: LaunchpadDatabase) {}

  list(): ServerRecord[] {
    return (this.database.raw.prepare('SELECT * FROM servers ORDER BY name COLLATE NOCASE').all() as unknown as ServerRow[]).map(mapRow)
  }

  get(id: string): ServerRecord | undefined {
    const row = this.database.raw.prepare('SELECT * FROM servers WHERE id = ?').get(id) as unknown as ServerRow | undefined
    return row ? mapRow(row) : undefined
  }

  create(input: ServerInput, credentialId?: string | null, requestedId?: string): ServerRecord {
    const now = new Date().toISOString()
    const id = requestedId ?? randomUUID()
    this.database.raw.prepare(`
      INSERT INTO servers
        (id, name, source, config_alias, host, port, username, auth_type, private_key_path, credential_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.name, input.source, input.configAlias ?? null, input.host, input.port,
      input.username, input.authType, input.privateKeyPath ?? null, credentialId ?? null,
      input.notes, now, now,
    )
    return this.get(id)!
  }

  update(id: string, input: ServerInput, credentialId?: string): ServerRecord {
    const existing = this.get(id)
    if (!existing) notFound(id)
    this.database.raw.prepare(`
      UPDATE servers SET name = ?, source = ?, config_alias = ?, host = ?, port = ?, username = ?,
        auth_type = ?, private_key_path = ?, credential_id = ?, notes = ?, updated_at = ? WHERE id = ?
    `).run(
      input.name, input.source, input.configAlias ?? null, input.host, input.port, input.username,
      input.authType, input.privateKeyPath ?? null,
      credentialId === undefined ? existing.credentialId ?? null : credentialId,
      input.notes, new Date().toISOString(), id,
    )
    return this.get(id)!
  }

  setFingerprint(id: string, fingerprint: string): ServerRecord {
    if (!this.get(id)) notFound(id)
    this.database.raw.prepare('UPDATE servers SET host_fingerprint = ?, updated_at = ? WHERE id = ?')
      .run(fingerprint, new Date().toISOString(), id)
    return this.get(id)!
  }

  delete(id: string): void {
    if (!this.get(id)) notFound(id)
    try {
      this.database.raw.prepare('DELETE FROM servers WHERE id = ?').run(id)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('FOREIGN KEY constraint failed')) {
        throw new LaunchpadError('RESOURCE_BUSY', 'Remove or move this server’s applications first', { resource: 'server', id })
      }
      throw error
    }
  }
}
