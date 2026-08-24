import { useMemo, useState } from 'react'
import type { RemoteAppInput, RemoteAppRecord, ServerInput } from '@ssh-launchpad/shared'
import { LaunchpadStore, useLaunchpad } from './state/launchpad-store.js'
import { Clock } from './components/clock.js'
import { SearchBar } from './components/search-bar.js'
import { ServerTabs } from './components/server-tabs.js'
import { StatusWidgets } from './components/status-widgets.js'
import { AppGrid } from './components/app-grid.js'
import { ServerDialog } from './components/server-dialog.js'
import { AppDialog } from './components/app-dialog.js'

function Workspace() {
  const { servers, apps, runtime, loading, error, createServer, createApp, updateApp, clearError } = useLaunchpad()
  const [selected, setSelected] = useState('all'); const [query, setQuery] = useState(''); const [dialog, setDialog] = useState<'server' | 'app' | null>(null); const [editing, setEditing] = useState<RemoteAppRecord | undefined>()
  const visibleApps = useMemo(() => apps.filter((app) => (selected === 'all' || app.serverId === selected) && `${app.name} ${app.remoteHost} ${app.localPort}`.toLowerCase().includes(query.toLowerCase())), [apps, query, selected])
  const { connect } = useLaunchpad()
  const handleOpen = (app: RemoteAppRecord) => { const tab = window.open('', '_blank'); if (runtime.get(app.id)?.status === 'healthy') { if (tab) tab.location.href = `${app.protocol}://127.0.0.1:${app.localPort}${app.healthPath}`; return } void connect(app, tab) }
  const healthy = [...runtime.values()].filter((entry) => entry.status === 'healthy').length
  const saveServer = async (input: ServerInput, credential?: { kind: 'password' | 'private-key-passphrase'; value: string }) => { await createServer(input, credential) }
  const saveApp = async (input: RemoteAppInput) => { if (editing) await updateApp(editing.id, input); else await createApp(input) }
  const appDialog = dialog === 'app' ? <AppDialog servers={servers} {...(editing ? { editing } : {})} onClose={() => { setDialog(null); setEditing(undefined) }} onSave={saveApp} /> : null
  return <main className="shell"><div className="ambient ambient-one" /><div className="ambient ambient-two" /><header className="top"><Clock /><div className="brand-row"><div className="brand-mark">⌁</div><div><span className="brand-kicker">LOCAL WORKSPACE</span><h1>SSH <i>Launchpad</i></h1></div><span className="secure-pill">● 本机运行</span></div><SearchBar value={query} onChange={setQuery} onAdd={() => setDialog(servers.length ? 'app' : 'server')} /><ServerTabs servers={servers} selected={selected} onSelect={setSelected} onManage={() => setDialog('server')} /></header><section className="content"><div className="content-heading"><div><span className="eyebrow">{selected === 'all' ? '所有入口' : servers.find((server) => server.id === selected)?.name ?? '服务器'}</span><h2>你的远程工作台</h2></div><div className="heading-actions"><span className="live-dot" />实时状态 <button className="icon-button" onClick={() => setDialog('app')} disabled={!servers.length}>＋</button></div></div><div className="workspace-row"><StatusWidgets serverCount={servers.length} healthyCount={healthy} /><div className="apps-column">{loading ? <div className="loading-state">正在唤醒工作台…</div> : <AppGrid apps={visibleApps} servers={servers} runtime={runtime} onOpen={handleOpen} onEdit={(app) => { setEditing(app); setDialog('app') }} onAdd={() => setDialog(servers.length ? 'app' : 'server')} />}</div></div></section>{error && <div className="toast error-toast"><span>!</span><div><strong>操作没有完成</strong><p>{error}</p></div><button onClick={clearError}>×</button></div>}{dialog === 'server' && <ServerDialog onClose={() => setDialog(null)} onSave={saveServer} />}{appDialog}</main>
}

export function LaunchpadApp() { return <LaunchpadStore><Workspace /></LaunchpadStore> }
