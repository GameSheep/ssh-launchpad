import type { ApiErrorBody, BootstrapResponse, RemoteAppInput, RemoteAppRecord, ServerInput, ServerRecord, ServerTestResult } from '@ssh-launchpad/shared'

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

export const api = {
  exchangeSession: (token: string) => request<{ ok: true }>('/api/session', { method: 'POST', body: JSON.stringify({ token }) }),
  controlStatus: () => request<{ authenticated: true; agents: Array<{ id: string; name: string; connected: boolean }> }>('/api/control/status'),
  createPairingCode: () => request<{ code: string; expiresAt: string }>('/api/agents/pairing-codes', { method: 'POST', body: '{}' }),
  bootstrap: () => request<BootstrapResponse>('/api/bootstrap'),
  servers: () => request<ServerRecord[]>('/api/servers'),
  createServer: (server: ServerInput, credential?: { kind: 'password' | 'private-key-passphrase'; value: string }) => request<ServerRecord>('/api/servers', { method: 'POST', body: JSON.stringify({ server, credential }) }),
  updateServer: (id: string, server: ServerInput, credential?: { kind: 'password' | 'private-key-passphrase'; value: string }) => request<ServerRecord>(`/api/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ server, credential }) }),
  deleteServer: (id: string) => request<{ ok: true }>(`/api/servers/${id}`, { method: 'DELETE' }),
  testServer: (id: string) => request<ServerTestResult>(`/api/servers/${id}/test`, { method: 'POST', body: '{}' }),
  confirmFingerprint: (id: string, candidateFingerprint: string) => request<ServerRecord>(`/api/servers/${id}/confirm-fingerprint`, { method: 'POST', body: JSON.stringify({ candidateFingerprint }) }),
  importSshConfig: (text: string) => request<{ hosts: Array<{ alias: string; host: string; port: number; username: string; identityFile?: string }>; warnings: string[] }>('/api/servers/import-ssh-config', { method: 'POST', body: JSON.stringify({ text }) }),
  apps: () => request<RemoteAppRecord[]>('/api/apps'),
  createApp: (app: RemoteAppInput) => request<RemoteAppRecord>('/api/apps', { method: 'POST', body: JSON.stringify({ app }) }),
  updateApp: (id: string, app: RemoteAppInput) => request<RemoteAppRecord>(`/api/apps/${id}`, { method: 'PATCH', body: JSON.stringify({ app }) }),
  deleteApp: (id: string) => request<{ ok: true }>(`/api/apps/${id}`, { method: 'DELETE' }),
  connect: (id: string) => request<{ url: string; status: 'healthy' }>(`/api/apps/${id}/connect`, { method: 'POST', body: '{}' }),
  disconnect: (id: string) => request<{ ok: true }>(`/api/apps/${id}/disconnect`, { method: 'POST', body: '{}' }),
  reconnect: (id: string) => request<{ url: string; status: 'healthy' }>(`/api/apps/${id}/reconnect`, { method: 'POST', body: '{}' }),
  logs: (id: string) => request<string[]>(`/api/apps/${id}/logs`),
}
