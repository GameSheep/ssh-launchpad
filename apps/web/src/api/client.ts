import type { ApiErrorBody, BootstrapResponse, RemoteAppInput, RemoteAppRecord, RuntimeSnapshot, ServerInput, ServerRecord, ServerTestResult } from '@ssh-launchpad/shared'
import { browserCredentials } from '../state/browser-credentials.js'

const LOCAL_BRIDGE_URL = 'http://127.0.0.1:4319'

export class ApiClientError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) { super(message) }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  const data = await response.json().catch(() => undefined) as T | ApiErrorBody | undefined
  if (!response.ok) {
    const error = data as ApiErrorBody | undefined
    throw new ApiClientError(error?.error.code ?? 'INTERNAL_ERROR', error?.error.message ?? '请求失败', error?.error.details)
  }
  return data as T
}

async function localRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${LOCAL_BRIDGE_URL}${path}`, { ...init, credentials: 'omit', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  } catch {
    throw new ApiClientError('LOCAL_BRIDGE_UNAVAILABLE', '请先在本机启动 SSH Launchpad Local Bridge（127.0.0.1:4319）')
  }
  const data = await response.json().catch(() => undefined) as T | ApiErrorBody | undefined
  if (!response.ok) {
    const error = data as ApiErrorBody | undefined
    throw new ApiClientError(error?.error.code ?? 'INTERNAL_ERROR', error?.error.message ?? '本机 SSH 桥接失败', error?.error.details)
  }
  return data as T
}

export const api = {
  exchangeSession: (token: string) => request<{ ok: true }>('/api/session', { method: 'POST', body: JSON.stringify({ token }) }),
  bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),
  servers: () => request<ServerRecord[]>('/api/servers'),
  createServer: (server: ServerInput) => request<ServerRecord>('/api/servers', { method: 'POST', body: JSON.stringify({ server }) }),
  updateServer: (id: string, server: ServerInput) => request<ServerRecord>(`/api/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ server }) }),
  deleteServer: (id: string) => request<{ ok: true }>(`/api/servers/${id}`, { method: 'DELETE' }),
  testServer: (id: string) => request<ServerTestResult>(`/api/servers/${id}/test`, { method: 'POST', body: JSON.stringify({ credential: browserCredentials.get(id) }) }),
  confirmFingerprint: (id: string, candidateFingerprint: string) => localRequest<ServerRecord>('/api/confirm-fingerprint', { method: 'POST', body: JSON.stringify({ serverId: id, candidateFingerprint }) }),
  importSshConfig: (text: string) => request<{ hosts: Array<{ alias: string; host: string; port: number; username: string; identityFile?: string }>; warnings: string[] }>('/api/servers/import-ssh-config', { method: 'POST', body: JSON.stringify({ text }) }),
  apps: () => request<RemoteAppRecord[]>('/api/apps'),
  createApp: (app: RemoteAppInput) => request<RemoteAppRecord>('/api/apps', { method: 'POST', body: JSON.stringify({ app }) }),
  updateApp: (id: string, app: RemoteAppInput) => request<RemoteAppRecord>(`/api/apps/${id}`, { method: 'PATCH', body: JSON.stringify({ app }) }),
  deleteApp: (id: string) => request<{ ok: true }>(`/api/apps/${id}`, { method: 'DELETE' }),
  localRuntime: () => localRequest<RuntimeSnapshot[]>('/api/runtime'),
  connect: (app: RemoteAppRecord, server: ServerRecord) => localRequest<{ url: string; status: 'healthy' }>('/api/connect', { method: 'POST', body: JSON.stringify({ app, server, credential: browserCredentials.get(server.id) }) }),
  disconnect: (id: string) => localRequest<{ ok: true }>('/api/disconnect', { method: 'POST', body: JSON.stringify({ appId: id }) }),
  reconnect: (app: RemoteAppRecord, server: ServerRecord) => localRequest<{ url: string; status: 'healthy' }>('/api/reconnect', { method: 'POST', body: JSON.stringify({ app, server, credential: browserCredentials.get(server.id) }) }),
  logs: (id: string) => request<string[]>(`/api/apps/${id}/logs`),
}
