import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RemoteAppInput, RemoteAppRecord, RuntimeSnapshot, ServerInput, ServerRecord } from '@ssh-launchpad/shared'
import { api, ApiClientError } from '../api/client.js'
import { browserCredentials } from './browser-credentials.js'
import { browserWorkspace } from './browser-workspace.js'

interface LaunchpadContextValue {
  servers: ServerRecord[]
  apps: RemoteAppRecord[]
  runtime: Map<string, RuntimeSnapshot>
  loading: boolean
  authReady: boolean
  needsLogin: boolean
  login(token: string): Promise<void>
  error: string
  pendingFingerprint?: { app: RemoteAppRecord; tab: Window | null; candidateFingerprint: string }
  fingerprintBusy: boolean
  refresh(): Promise<void>
  createServer(input: ServerInput): Promise<ServerRecord>
  updateServer(id: string, input: ServerInput): Promise<ServerRecord>
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
  const [authReady, setAuthReady] = useState(false)
  const [needsLogin, setNeedsLogin] = useState(false)
  const [error, setError] = useState('')
  const [pendingFingerprint, setPendingFingerprint] = useState<LaunchpadContextValue['pendingFingerprint']>()
  const [fingerprintBusy, setFingerprintBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      await api.bootstrap()
      const workspace = browserWorkspace.read()
      const localRuntime = await api.localRuntime().catch(() => undefined)
      setServers(workspace.servers); setApps(workspace.apps); setRuntime(new Map((localRuntime ?? []).map((entry) => [entry.appId, entry])))
      setNeedsLogin(false); setAuthReady(true); setError('')
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.code === 'SESSION_INVALID') { setNeedsLogin(true); setAuthReady(true); setError('') }
      else { setAuthReady(true); setError(cause instanceof Error ? cause.message : '无法加载工作台') }
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!authReady || needsLogin) return
    const timer = setInterval(() => { void api.localRuntime().then((snapshots) => setRuntime(new Map(snapshots.map((entry) => [entry.appId, entry])))).catch(() => undefined) }, 3000)
    return () => clearInterval(timer)
  }, [authReady, needsLogin])

  const login = useCallback(async (token: string) => {
    await api.exchangeSession(token)
    setNeedsLogin(false); setAuthReady(true)
    await refresh()
  }, [refresh])

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T> => {
    try { const result = await operation(); setError(''); await refresh(); return result } catch (cause) { setError(cause instanceof ApiClientError ? cause.message : cause instanceof Error ? cause.message : '操作失败'); throw cause }
  }, [refresh])

  const connect = useCallback(async (app: RemoteAppRecord, tab?: Window | null) => {
    try {
      const server = servers.find((entry) => entry.id === app.serverId)
      if (!server) throw new ApiClientError('NOT_FOUND', '应用所属的服务器不存在')
      const result = await api.connect(app, server)
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
  }, [refresh, servers])
  const confirmPendingFingerprint = useCallback(async () => {
    const pending = pendingFingerprint
    if (!pending) return
    // Close the confirmation surface immediately after the user commits. The
    // browser tab may take a few seconds to finish SSH + health checks.
    setPendingFingerprint(undefined)
    setFingerprintBusy(true)
    try {
      const confirmed = await api.confirmFingerprint(pending.app.serverId, pending.candidateFingerprint)
      const server = browserWorkspace.updateServerFingerprint(pending.app.serverId, confirmed.hostFingerprint ?? pending.candidateFingerprint)
      const result = await api.connect(pending.app, server)
      if (pending.tab) pending.tab.location.href = result.url
      await refresh()
    } catch (cause) {
      setPendingFingerprint(pending)
      setError(cause instanceof Error ? cause.message : '指纹确认失败')
    } finally {
      setFingerprintBusy(false)
    }
  }, [pendingFingerprint, refresh, servers])
  const rejectPendingFingerprint = useCallback(() => {
    pendingFingerprint?.tab?.close()
    setPendingFingerprint(undefined)
  }, [pendingFingerprint])
  const value = useMemo<LaunchpadContextValue>(() => ({
    servers, apps, runtime, loading, error, fingerprintBusy, authReady, needsLogin, login, ...(pendingFingerprint ? { pendingFingerprint } : {}), refresh,
    connect,
    confirmPendingFingerprint,
    rejectPendingFingerprint,
    disconnect: (appId) => run(() => api.disconnect(appId).then(() => undefined)),
    clearError: () => setError(''),
    createServer: async (input) => { const result = browserWorkspace.createServer(input); await refresh(); return result },
    updateServer: async (id, input) => { const result = browserWorkspace.updateServer(id, input); await refresh(); return result },
    removeServer: async (id) => { browserWorkspace.deleteServer(id); browserCredentials.remove(id); await refresh() },
    createApp: async (input) => { const result = browserWorkspace.createApp(input); await refresh(); return result },
    updateApp: async (id, input) => { const result = browserWorkspace.updateApp(id, input); await refresh(); return result },
    removeApp: async (id) => { browserWorkspace.deleteApp(id); await refresh() },
  }), [apps, authReady, confirmPendingFingerprint, connect, error, fingerprintBusy, loading, login, needsLogin, pendingFingerprint, refresh, rejectPendingFingerprint, runtime, servers])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useLaunchpad(): LaunchpadContextValue {
  const value = useContext(StoreContext)
  if (!value) throw new Error('useLaunchpad must be used inside LaunchpadStore')
  return value
}
