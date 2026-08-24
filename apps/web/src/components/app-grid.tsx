import type { RemoteAppRecord, RuntimeSnapshot, ServerRecord } from '@ssh-launchpad/shared'

const typeLabel = { dsh: 'DeepSeek Harness', openclaw: 'OpenClaw', custom: '自定义服务' }
const typeGlyph = { dsh: '◈', openclaw: '⌁', custom: '↗' }

export function AppGrid({ apps, servers, runtime, onOpen, onEdit, onAdd }: { apps: RemoteAppRecord[]; servers: ServerRecord[]; runtime: Map<string, RuntimeSnapshot>; onOpen(app: RemoteAppRecord): void; onEdit(app: RemoteAppRecord): void; onAdd(): void }) {
  if (!apps.length) return <div className="empty-state"><div className="empty-glyph">＋</div><h2>把常用服务放在这里</h2><p>添加一台服务器，再为它配置 DSH、OpenClaw 或任意 SSH 端口服务。</p><button className="primary" onClick={onAdd}>添加第一个应用</button></div>
  return <div className="app-grid">{apps.map((app) => { const status = runtime.get(app.id)?.status ?? 'disconnected'; const server = servers.find((item) => item.id === app.serverId); return <article key={app.id} className={`app-card status-${status}`}><button className="app-icon" onClick={() => onOpen(app)} title={`打开 ${app.name}`}><span>{app.iconKind === 'url' ? <img src={app.iconValue} alt="" /> : app.iconKind === 'letter' ? app.iconValue.slice(0, 2) : typeGlyph[app.type]}</span><i className="status-light" /></button><button className="app-info" onClick={() => onOpen(app)}><strong>{app.name}</strong><span>{server?.name ?? '未知服务器'} · {app.localPort}</span><em>{typeLabel[app.type]}</em></button><button className="app-edit" onClick={() => onEdit(app)} aria-label={`编辑 ${app.name}`}>•••</button></article> })}</div>
}
