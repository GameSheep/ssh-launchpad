import type { ApiErrorBody, BootstrapResponse, RemoteAppRecord, RuntimeSnapshot, ServerRecord } from '@ssh-launchpad/shared'
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
  confirmFingerprint: (id: string, candidateFingerprint: string) => localRequest<ServerRecord>('/api/confirm-fingerprint', { method: 'POST', body: JSON.stringify({ serverId: id, candidateFingerprint }) }),
  localRuntime: () => localRequest<RuntimeSnapshot[]>('/api/runtime'),
  connect: (app: RemoteAppRecord, server: ServerRecord) => localRequest<{ url: string; status: 'healthy' }>('/api/connect', { method: 'POST', body: JSON.stringify({ app, server, credential: browserCredentials.get(server.id) }) }),
  disconnect: (id: string) => localRequest<{ ok: true }>('/api/disconnect', { method: 'POST', body: JSON.stringify({ appId: id }) }),
}
