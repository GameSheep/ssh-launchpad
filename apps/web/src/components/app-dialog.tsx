import { useState, type FormEvent } from 'react'
import type { RemoteAppInput, RemoteAppRecord, ServerInput, ServerRecord } from '@ssh-launchpad/shared'

function initial(serverId: string): RemoteAppInput {
  return { serverId, name: '', type: 'dsh', remoteHost: '127.0.0.1', remotePort: 3080, localPort: 13080, protocol: 'http', healthPath: '/', autoStart: true, workingDirectory: '', startCommand: '', stopOnDisconnect: false, stopCommand: '', iconKind: 'letter', iconValue: 'DS', startTimeoutMs: 30000, healthTimeoutMs: 10000 }
}

export function AppDialog({ servers, editing, onClose, onSave }: { servers: ServerRecord[]; editing?: RemoteAppRecord; onClose(): void; onSave(input: RemoteAppInput, quickServer?: { server: ServerInput; credential?: { kind: 'password' | 'private-key-passphrase'; value: string } }): Promise<void> }) {
  const [value, setValue] = useState<RemoteAppInput>(() => editing ? { ...editing } : initial(servers[0]?.id ?? ''))
  const [saving, setSaving] = useState(false)
  const [server, setServer] = useState<ServerInput>({ name: '', source: 'manual', host: '', port: 22, username: '', authType: 'password', notes: '' })
  const [secret, setSecret] = useState('')
  const update = <K extends keyof RemoteAppInput>(key: K, next: RemoteAppInput[K]) => setValue((current) => ({ ...current, [key]: next }))
  const updateServer = <K extends keyof ServerInput>(key: K, next: ServerInput[K]) => setServer((current) => ({ ...current, [key]: next }))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      const credential = secret ? { kind: server.authType === 'private-key' ? 'private-key-passphrase' as const : 'password' as const, value: secret } : undefined
      await onSave(value, servers.length || editing ? undefined : { server, ...(credential ? { credential } : {}) }); onClose()
    } catch { /* parent displays the error */ } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="modal wide-modal" onSubmit={submit}>
      <header className="modal-header"><div><span className="eyebrow">远程服务</span><h2>{editing ? '编辑应用' : '添加应用'}</h2><p className="modal-subtitle">{servers.length || editing ? '选择入口，保存后即可一键打开' : '一次填写 SSH 和应用，保存后直接出现在工作台'}</p></div><button type="button" className="modal-close" onClick={onClose}>×</button></header>
      <div className="modal-body">
        {!servers.length && !editing && <section className="quick-server"><div className="section-title"><span className="section-number">01</span><div><strong>SSH 连接</strong><small>先把这台服务器记住，凭据只保存在当前浏览器</small></div></div><div className="form-grid">
          <label>服务器名称<input required value={server.name} onChange={(event) => updateServer('name', event.target.value)} placeholder="例如：GPU 训练机" /></label>
          <label>地址<input required value={server.host} onChange={(event) => updateServer('host', event.target.value)} placeholder="10.0.0.2" /></label>
          <label>SSH 端口<input required type="number" min="1" max="65535" value={server.port} onChange={(event) => updateServer('port', Number(event.target.value))} /></label>
          <label>用户名<input required value={server.username} onChange={(event) => updateServer('username', event.target.value)} placeholder="root" /></label>
          <label>认证方式<select value={server.authType} onChange={(event) => updateServer('authType', event.target.value as ServerInput['authType'])}><option value="password">密码</option><option value="private-key">私钥文件</option><option value="ssh-config">SSH Agent / Config</option></select></label>
          <label>凭据<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="只保存到当前浏览器" /></label>
          {server.authType === 'private-key' && <label className="wide">私钥路径<input value={server.privateKeyPath ?? ''} onChange={(event) => updateServer('privateKeyPath', event.target.value)} placeholder="C:\\Users\\你\\.ssh\\id_ed25519" /></label>}
        </div></section>}
        <section className="quick-app"><div className="section-title"><span className="section-number">{servers.length || editing ? '01' : '02'}</span><div><strong>应用入口</strong><small>以后点击这个图标就能连接并打开浏览器</small></div></div><div className="form-grid">
          <label>所属服务器<select required value={value.serverId} disabled={!servers.length} onChange={(event) => update('serverId', event.target.value)}>{servers.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.host}</option>)}{!servers.length && <option value="">上面的新服务器</option>}</select></label>
          <label>应用名称<input required value={value.name} onChange={(event) => update('name', event.target.value)} placeholder="DeepSeek Harness" /></label>
          <label>应用类型<select value={value.type} onChange={(event) => update('type', event.target.value as RemoteAppInput['type'])}><option value="dsh">DeepSeek Harness</option><option value="openclaw">OpenClaw</option><option value="custom">自定义</option></select></label>
          <label>图标文字<input maxLength={3} value={value.iconValue} onChange={(event) => update('iconValue', event.target.value)} placeholder="DS" /></label>
          <label>远端地址<input required value={value.remoteHost} onChange={(event) => update('remoteHost', event.target.value)} /></label>
          <label>远端端口<input required type="number" min="1" max="65535" value={value.remotePort} onChange={(event) => update('remotePort', Number(event.target.value))} /></label>
          <label>本地端口<input required type="number" min="1" max="65535" value={value.localPort} onChange={(event) => update('localPort', Number(event.target.value))} /><small>全局唯一，冲突时不会自动改号</small></label>
          <label>访问协议<select value={value.protocol} onChange={(event) => update('protocol', event.target.value as RemoteAppInput['protocol'])}><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
          <label className="wide">健康检查路径<input required value={value.healthPath} onChange={(event) => update('healthPath', event.target.value)} /></label>
          <label className="wide check-row"><input type="checkbox" checked={value.autoStart} onChange={(event) => update('autoStart', event.target.checked)} /><span>连接时自动启动远端程序</span></label>
          {value.autoStart && <label className="wide">启动命令<input required value={value.startCommand ?? ''} onChange={(event) => update('startCommand', event.target.value)} placeholder="python -m deepseek_harness --port 3080" /></label>}
          <label className="wide">工作目录<input value={value.workingDirectory ?? ''} onChange={(event) => update('workingDirectory', event.target.value)} placeholder="/opt/deepseek-harness" /></label>
          <label className="wide check-row"><input type="checkbox" checked={value.stopOnDisconnect} onChange={(event) => update('stopOnDisconnect', event.target.checked)} /><span>断开时执行显式停止命令</span></label>
          {value.stopOnDisconnect && <label className="wide">停止命令<input required value={value.stopCommand ?? ''} onChange={(event) => update('stopCommand', event.target.value)} placeholder="docker compose stop" /></label>}
        </div></section>
      </div>
      <footer className="modal-footer"><span className="security-note">⚠ 启动命令将在远程服务器执行</span><button type="button" className="ghost" onClick={onClose}>取消</button><button className="primary" disabled={saving || (!servers.length && (!server.name || !server.host || !server.username))}>{saving ? '保存中…' : editing ? '保存修改' : '添加应用'}</button></footer>
    </form>
  </div>
}
