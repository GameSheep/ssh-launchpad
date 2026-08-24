import { randomUUID } from 'node:crypto'
import type { RemoteAppInput, RemoteAppRecord } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { LaunchpadDatabase } from './database.js'

type AppRow = {
  id: string
  server_id: string
  name: string
  type: RemoteAppRecord['type']
  remote_host: string
  remote_port: number
  local_port: number
  protocol: RemoteAppRecord['protocol']
  health_path: string
  auto_start: number
  working_directory: string | null
  start_command: string | null
  stop_on_disconnect: number
  stop_command: string | null
  icon_kind: RemoteAppRecord['iconKind']
  icon_value: string
  start_timeout_ms: number
  health_timeout_ms: number
  created_at: string
  updated_at: string
}

export interface AppRepository {
  list(serverId?: string): RemoteAppRecord[]
  get(id: string): RemoteAppRecord | undefined
  create(input: RemoteAppInput): RemoteAppRecord
  update(id: string, input: RemoteAppInput): RemoteAppRecord
  delete(id: string): void
  findByLocalPort(port: number, excludeId?: string): RemoteAppRecord | undefined
}

function mapRow(row: AppRow): RemoteAppRecord {
  const record: RemoteAppRecord = {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    type: row.type,
    remoteHost: row.remote_host,
    remotePort: row.remote_port,
    localPort: row.local_port,
    protocol: row.protocol,
    healthPath: row.health_path,
    autoStart: row.auto_start === 1,
    stopOnDisconnect: row.stop_on_disconnect === 1,
    iconKind: row.icon_kind,
    iconValue: row.icon_value,
    startTimeoutMs: row.start_timeout_ms,
    healthTimeoutMs: row.health_timeout_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
  if (row.working_directory !== null) record.workingDirectory = row.working_directory
  if (row.start_command !== null) record.startCommand = row.start_command
  if (row.stop_command !== null) record.stopCommand = row.stop_command
  return record
}

function notFound(id: string): never {
  throw new LaunchpadError('NOT_FOUND', `Application ${id} was not found`, { resource: 'app', id })
}

export class SqliteAppRepository implements AppRepository {
  constructor(private readonly database: LaunchpadDatabase) {}

  list(serverId?: string): RemoteAppRecord[] {
    const rows = serverId
      ? this.database.raw.prepare('SELECT * FROM remote_apps WHERE server_id = ? ORDER BY name COLLATE NOCASE').all(serverId)
      : this.database.raw.prepare('SELECT * FROM remote_apps ORDER BY name COLLATE NOCASE').all()
    return (rows as unknown as AppRow[]).map(mapRow)
  }

  get(id: string): RemoteAppRecord | undefined {
    const row = this.database.raw.prepare('SELECT * FROM remote_apps WHERE id = ?').get(id) as unknown as AppRow | undefined
    return row ? mapRow(row) : undefined
  }

  findByLocalPort(port: number, excludeId?: string): RemoteAppRecord | undefined {
    const row = excludeId
      ? this.database.raw.prepare('SELECT * FROM remote_apps WHERE local_port = ? AND id != ?').get(port, excludeId)
      : this.database.raw.prepare('SELECT * FROM remote_apps WHERE local_port = ?').get(port)
    return row ? mapRow(row as unknown as AppRow) : undefined
  }

  create(input: RemoteAppInput): RemoteAppRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    try {
      this.database.raw.prepare(`
        INSERT INTO remote_apps
          (id, server_id, name, type, remote_host, remote_port, local_port, protocol, health_path, auto_start,
           working_directory, start_command, stop_on_disconnect, stop_command, icon_kind, icon_value,
           start_timeout_ms, health_timeout_ms, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.serverId, input.name, input.type, input.remoteHost, input.remotePort, input.localPort,
        input.protocol, input.healthPath, input.autoStart ? 1 : 0, input.workingDirectory ?? null,
        input.startCommand ?? null, input.stopOnDisconnect ? 1 : 0, input.stopCommand ?? null,
        input.iconKind, input.iconValue, input.startTimeoutMs, input.healthTimeoutMs, now, now,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('UNIQUE constraint failed: remote_apps.local_port')) {
        throw new LaunchpadError('LOCAL_PORT_IN_USE', `Local port ${input.localPort} is already configured`, { localPort: input.localPort })
      }
      throw error
    }
    return this.get(id)!
  }

  update(id: string, input: RemoteAppInput): RemoteAppRecord {
    if (!this.get(id)) notFound(id)
    try {
      this.database.raw.prepare(`
        UPDATE remote_apps SET server_id = ?, name = ?, type = ?, remote_host = ?, remote_port = ?, local_port = ?,
          protocol = ?, health_path = ?, auto_start = ?, working_directory = ?, start_command = ?,
          stop_on_disconnect = ?, stop_command = ?, icon_kind = ?, icon_value = ?, start_timeout_ms = ?,
          health_timeout_ms = ?, updated_at = ? WHERE id = ?
      `).run(
        input.serverId, input.name, input.type, input.remoteHost, input.remotePort, input.localPort,
        input.protocol, input.healthPath, input.autoStart ? 1 : 0, input.workingDirectory ?? null,
        input.startCommand ?? null, input.stopOnDisconnect ? 1 : 0, input.stopCommand ?? null,
        input.iconKind, input.iconValue, input.startTimeoutMs, input.healthTimeoutMs,
        new Date().toISOString(), id,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('UNIQUE constraint failed: remote_apps.local_port')) {
        throw new LaunchpadError('LOCAL_PORT_IN_USE', `Local port ${input.localPort} is already configured`, { localPort: input.localPort })
      }
      throw error
    }
    return this.get(id)!
  }

  delete(id: string): void {
    if (!this.get(id)) notFound(id)
    this.database.raw.prepare('DELETE FROM remote_apps WHERE id = ?').run(id)
  }
}
