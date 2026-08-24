import type { RemoteAppInput, RemoteAppRecord, ServerInput, ServerRecord } from '@ssh-launchpad/shared'

interface BrowserWorkspaceData {
  servers: ServerRecord[]
  apps: RemoteAppRecord[]
}

const STORAGE_KEY = 'ssh-launchpad.workspace.v2'

function id(prefix: string): string {
  const generated = globalThis.crypto?.randomUUID?.()
  return generated ? `${prefix}-${generated}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function now(): string { return new Date().toISOString() }

function read(): BrowserWorkspaceData {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { servers: [], apps: [] }
    const data = value as Partial<BrowserWorkspaceData>
    return {
      servers: Array.isArray(data.servers) ? data.servers as ServerRecord[] : [],
      apps: Array.isArray(data.apps) ? data.apps as RemoteAppRecord[] : [],
    }
  } catch {
    return { servers: [], apps: [] }
  }
}

function write(value: BrowserWorkspaceData): void { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) }

function requireServer(data: BrowserWorkspaceData, idValue: string): ServerRecord {
  const server = data.servers.find((item) => item.id === idValue)
  if (!server) throw new Error('服务器不存在')
  return server
}

function assertLocalPortAvailable(data: BrowserWorkspaceData, localPort: number, excludeId?: string): void {
  const conflict = data.apps.find((item) => item.localPort === localPort && item.id !== excludeId)
  if (conflict) throw new Error(`本地端口 ${localPort} 已被应用“${conflict.name}”占用`)
}

export const browserWorkspace = {
  read,

  createServer(input: ServerInput): ServerRecord {
    const data = read(); const timestamp = now()
    const record: ServerRecord = { ...input, id: id('server'), createdAt: timestamp, updatedAt: timestamp }
    data.servers.push(record); write(data); return record
  },

  updateServer(serverId: string, input: ServerInput): ServerRecord {
    const data = read(); const index = data.servers.findIndex((item) => item.id === serverId)
    if (index < 0) throw new Error('服务器不存在')
    const record: ServerRecord = { ...data.servers[index]!, ...input, id: serverId, updatedAt: now() }
    data.servers[index] = record; write(data); return record
  },

  updateServerFingerprint(serverId: string, fingerprint: string): ServerRecord {
    const data = read(); const server = requireServer(data, serverId)
    const record: ServerRecord = { ...server, hostFingerprint: fingerprint, updatedAt: now() }
    data.servers = data.servers.map((item) => item.id === serverId ? record : item); write(data); return record
  },

  deleteServer(serverId: string): void {
    const data = read(); requireServer(data, serverId)
    if (data.apps.some((item) => item.serverId === serverId)) throw new Error('请先删除这台服务器上的应用')
    data.servers = data.servers.filter((item) => item.id !== serverId); write(data)
  },

  createApp(input: RemoteAppInput): RemoteAppRecord {
    const data = read(); requireServer(data, input.serverId); assertLocalPortAvailable(data, input.localPort)
    const timestamp = now(); const record: RemoteAppRecord = { ...input, id: id('app'), createdAt: timestamp, updatedAt: timestamp }
    data.apps.push(record); write(data); return record
  },

  updateApp(appId: string, input: RemoteAppInput): RemoteAppRecord {
    const data = read(); const index = data.apps.findIndex((item) => item.id === appId)
    if (index < 0) throw new Error('应用不存在')
    requireServer(data, input.serverId); assertLocalPortAvailable(data, input.localPort, appId)
    const record: RemoteAppRecord = { ...data.apps[index]!, ...input, id: appId, updatedAt: now() }
    data.apps[index] = record; write(data); return record
  },

  deleteApp(appId: string): void {
    const data = read()
    if (!data.apps.some((item) => item.id === appId)) throw new Error('应用不存在')
    data.apps = data.apps.filter((item) => item.id !== appId); write(data)
  },
}

