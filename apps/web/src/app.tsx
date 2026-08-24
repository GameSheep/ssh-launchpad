import { useMemo, useState } from 'react'
import type { RemoteAppInput, RemoteAppRecord, ServerInput, ServerRecord } from '@ssh-launchpad/shared'
import { LaunchpadStore, useLaunchpad } from './state/launchpad-store.js'
import { Clock } from './components/clock.js'
import { SearchBar } from './components/search-bar.js'
import { ServerTabs } from './components/server-tabs.js'
import { StatusWidgets } from './components/status-widgets.js'
import { AppGrid } from './components/app-grid.js'
import { ServerDialog } from './components/server-dialog.js'
import { AppDialog } from './components/app-dialog.js'
import { ControlLogin } from './components/control-gate.js'
import { browserCredentials } from './state/browser-credentials.js'

function Workspace() {
  const { servers, apps, runtime, loading, error, pendingFingerprint, fingerprintBusy, createServer, updateServer, createApp, updateApp, clearError, confirmPendingFingerprint, rejectPendingFingerprint } = useLaunchpad()
  const [selected, setSelected] = useState('all'); const [query, setQuery] = useState(''); const [dialog, setDialog] = useState<'server' | 'app' | null>(null); const [editing, setEditing] = useState<RemoteAppRecord | undefined>(); const [editingServer, setEditingServer] = useState<ServerRecord | undefined>()
  const visibleApps = useMemo(() => apps.filter((app) => (selected === 'all' || app.serverId === selected) && `${app.name} ${app.remoteHost} ${app.localPort}`.toLowerCase().includes(query.toLowerCase())), [apps, query, selected])
  const { connect } = useLaunchpad()
  const handleOpen = (app: RemoteAppRecord) => { const tab = window.open('', '_blank'); if (tab) { try { tab.document.title = `正在连接 · ${app.name}`; tab.document.body.innerHTML = '<main style="font:16px Segoe UI,sans-serif;padding:48px;color:#e9e1d8;background:#211f1e;min-height:100vh"><strong>正在建立 SSH 隧道…</strong><p style="color:#9f958c">确认主机指纹后，这个标签页会自动打开应用。</p></main>' } catch { /* browser may already have navigated */ } } void connect(app, tab) }
  const healthy = [...runtime.values()].filter((entry) => entry.status === 'healthy').length
  const saveServer = async (input: ServerInput, credential?: { kind: 'password' | 'private-key-passphrase'; value: string }) => { const saved = editingServer ? await updateServer(editingServer.id, input) : await createServer(input); if (credential) browserCredentials.set(saved.id, credential) }
  const saveApp = async (input: RemoteAppInput, quickServer?: { server: ServerInput; credential?: { kind: 'password' | 'private-key-passphrase'; value: string } }) => { if (editing) await updateApp(editing.id, input); else { const saved = quickServer ? await createServer(quickServer.server) : undefined; if (saved && quickServer?.credential) browserCredentials.set(saved.id, quickServer.credential); await createApp({ ...input, serverId: saved?.id ?? input.serverId }) } }
  const openServerDialog = (serverId?: string) => { setEditingServer(serverId ? servers.find((server) => server.id === serverId) : undefined); setDialog('server') }
  const closeServerDialog = () => { setDialog(null); setEditingServer(undefined) }
  const appDialog = dialog === 'app' ? <AppDialog servers={servers} {...(editing ? { editing } : {})} onClose={() => { setDialog(null); setEditing(undefined) }} onSave={saveApp} /> : null
  return <main className="shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><header className="top"><Clock /><div className="brand-row"><div className="brand-mark">⌁</div><div><span className="brand-kicker">REMOTE WORKSPACE</span><h1>SSH <i>Launchpad</i></h1></div><span className="secure-pill">● 本机 SSH 模式</span></div><SearchBar value={query} onChange={setQuery} onAdd={() => setDialog('app')} /><ServerTabs servers={servers} selected={selected} onSelect={setSelected} onManage={openServerDialog} /></header><section className="content"><div className="content-heading"><div><span className="eyebrow">{selected === 'all' ? '所有入口' : servers.find((server) => server.id === selected)?.name ?? '服务器'}</span><h2>你的远程工作台</h2></div><div className="heading-actions"><span className="live-dot" />实时状态 <button className="icon-button" onClick={() => setDialog('app')}>＋</button></div></div><div className="workspace-row"><StatusWidgets serverCount={servers.length} healthyCount={healthy} /><div className="apps-column">{loading ? <div className="loading-state">正在唤醒工作台…</div> : <AppGrid apps={visibleApps} servers={servers} runtime={runtime} onOpen={handleOpen} onEdit={(app) => { setEditing(app); setDialog('app') }} onAdd={() => setDialog('app')} />}</div></div></section>{error && <div className="toast error-toast"><span>!</span><div><strong>操作没有完成</strong><p>{error}</p></div><button onClick={clearError}>×</button></div>}{fingerprintBusy && <div className="toast connection-toast"><span>⌁</span><div><strong>正在打开应用</strong><p>SSH 指纹已确认，正在建立隧道并检查服务。</p></div></div>}{pendingFingerprint && <div className="modal-backdrop"><section className="fingerprint-card"><div className="fingerprint-icon">⌁</div><span className="eyebrow">首次连接确认</span><h2>确认这台 SSH 主机？</h2><p>服务器 <strong>{pendingFingerprint.app.name}</strong> 返回了一个尚未保存的主机指纹。确认后会保存到本机，并继续打开应用。</p><code>{pendingFingerprint.candidateFingerprint}</code><div className="fingerprint-warning">只在你确认服务器地址正确时继续。指纹变化会被阻止。</div><footer><button className="ghost" onClick={rejectPendingFingerprint}>取消</button><button className="primary" disabled={fingerprintBusy} onClick={() => void confirmPendingFingerprint()}>{fingerprintBusy ? '连接中…' : '确认并继续'}</button></footer></section></div>}{dialog === 'server' && <ServerDialog key={editingServer?.id ?? 'new'} {...(editingServer ? { editing: editingServer } : {})} onClose={closeServerDialog} onSave={saveServer} />}{appDialog}</main>
}

function ControlGate() {
  const { authReady, needsLogin } = useLaunchpad()
  if (!authReady) return <main className="control-shell"><div className="control-loading">正在连接控制平面…</div></main>
  if (needsLogin) return <ControlLogin />
  return <Workspace />
}

export function LaunchpadApp() { return <LaunchpadStore><ControlGate /></LaunchpadStore> }
