import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { BootstrapResponse, RemoteAppInput, RemoteAppRecord, RuntimeSnapshot, ServerInput, ServerRecord } from '@ssh-launchpad/shared'
import { api, ApiClientError } from '../api/client.js'

interface LaunchpadContextValue {
  servers: ServerRecord[]
  apps: RemoteAppRecord[]
  runtime: Map<string, RuntimeSnapshot>
  loading: boolean
  error: string
  pendingFingerprint?: { app: RemoteAppRecord; tab: Window | null; candidateFingerprint: string }
  refresh(): Promise<void>
  createServer(input: ServerInput, credential?: { kind: 'password' | 'private-key-passphrase'; value: string }): Promise<ServerRecord>
  updateServer(id: string, input: ServerInput, credential?: { kind: 'password' | 'private-key-passphrase'; value: string }): Promise<ServerRecord>
  removeServer(id: string): Promise<void>
  createApp(input: RemoteAppInput): Promise<RemoteAppRecord>
  updateApp(id: string, input: RemoteAppInput): Promise<RemoteAppRecord>
  removeApp(id: string): Promise<void>
  connect(app: RemoteAppRecord, tab?: Window | null): Promise<void>
  confirmPendingFingerprint(): Promise<void>
  rejectPendingFingerprint(): void
  disconnect(appId: string): Promise<void>
  clearError(): void
}

const StoreContext = createContext<LaunchpadContextValue | undefined>(undefined)

export function LaunchpadStore({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<ServerRecord[]>([])
  const [apps, setApps] = useState<RemoteAppRecord[]>([])
  const [runtime, setRuntime] = useState<Map<string, RuntimeSnapshot>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingFingerprint, setPendingFingerprint] = useState<LaunchpadContextValue['pendingFingerprint']>()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const value: BootstrapResponse = await api.bootstrap()
      setServers(value.servers); setApps(value.apps); setRuntime(new Map(value.runtime.map((entry) => [entry.appId, entry])))
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法加载工作台') } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void refresh()
    const events = new EventSource('/api/events')
    const onEvent = (event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as { snapshot?: RuntimeSnapshot; snapshots?: RuntimeSnapshot[] }
        if (event.type === 'runtime' && value.snapshot) setRuntime((current) => new Map(current).set(value.snapshot!.appId, value.snapshot!))
        if (event.type === 'snapshot' && value.snapshots) setRuntime(new Map(value.snapshots.map((entry) => [entry.appId, entry])))
      } catch { /* ignore malformed event */ }
    }
    events.addEventListener('runtime', onEvent); events.addEventListener('snapshot', onEvent)
    return () => events.close()
  }, [refresh])

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try { const result = await operation(); setError(''); await refresh(); return result } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : cause instanceof Error ? cause.message : '操作失败'); throw cause }
  }, [refresh])

  const connect = useCallback(async (app: RemoteAppRecord, tab?: Window | null) => {
    try {
      const result = await api.connect(app.id)
      if (tab) tab.location.href = result.url
      await refresh()
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'SSH_HOST_KEY_UNKNOWN' && typeof cause.details?.candidateFingerprint === 'string') {
        setPendingFingerprint({ app, tab: tab ?? null, candidateFingerprint: cause.details.candidateFingerprint })
        return
      }
      if (tab) tab.close()
      setError(cause instanceof Error ? cause.message : '连接失败')
    }
  }, [refresh])
  const confirmPendingFingerprint = useCallback(async () => {
    const pending = pendingFingerprint
    if (!pending) return
    try {
      await api.confirmFingerprint(pending.app.serverId, pending.candidateFingerprint)
      const result = await api.connect(pending.app.id)
      if (pending.tab) pending.tab.location.href = result.url
      setPendingFingerprint(undefined)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '指纹确认失败')
    }
  }, [pendingFingerprint, refresh])
  const rejectPendingFingerprint = useCallback(() => {
    pendingFingerprint?.tab?.close()
    setPendingFingerprint(undefined)
  }, [pendingFingerprint])
  const value = useMemo<LaunchpadContextValue>(() => ({
    servers, apps, runtime, loading, error, ...(pendingFingerprint ? { pendingFingerprint } : {}), refresh,
    createServer: (input, credential) => run(() => api.createServer(input, credential)),
    updateServer: (id, input, credential) => run(() => api.updateServer(id, input, credential)),
    removeServer: (id) => run(() => api.deleteServer(id).then(() => undefined)),
    createApp: (input) => run(() => api.createApp(input)),
    updateApp: (id, input) => run(() => api.updateApp(id, input)),
    removeApp: (id) => run(() => api.deleteApp(id).then(() => undefined)),
    connect,
    confirmPendingFingerprint,
    rejectPendingFingerprint,
    disconnect: (appId) => run(() => api.disconnect(appId).then(() => undefined)),
    clearError: () => setError(''),
  }), [apps, confirmPendingFingerprint, connect, error, loading, pendingFingerprint, refresh, rejectPendingFingerprint, run, runtime, servers])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useLaunchpad(): LaunchpadContextValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useLaunchpad must be used inside LaunchpadStore')
  return value
}
