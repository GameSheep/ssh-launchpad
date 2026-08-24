import type { ServerRecord } from '@ssh-launchpad/shared'

export function ServerTabs({ servers, selected, onSelect, onManage }: { servers: ServerRecord[]; selected: string; onSelect(id: string): void; onManage(): void }) {
  return <nav className="server-tabs" aria-label="服务器分组"><button className={selected === 'all' ? 'active' : ''} onClick={() => onSelect('all')}><span className="tab-dot all" />全部设备</button>{servers.map((server) => <button key={server.id} className={selected === server.id ? 'active' : ''} onClick={() => onSelect(server.id)}><span className="tab-dot" />{server.name}<small>{server.host}</small></button>)}<button className="tab-manage" onClick={onManage}>＋ 管理服务器</button></nav>
}
