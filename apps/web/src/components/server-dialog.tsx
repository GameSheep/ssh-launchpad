import { useState, type FormEvent } from 'react'
import type { ServerInput, ServerRecord } from '@ssh-launchpad/shared'
import { serverInputFromRecord } from './server-dialog-model.js'
import { parseSshConfig } from '../state/ssh-config-parser.js'

export function ServerDialog({ editing, onClose, onSave }: { editing?: ServerRecord; onClose(): void; onSave(input: ServerInput, credential?: { kind: 'password' | 'private-key-passphrase'; value: string }): Promise<void> }) {
  const [value, setValue] = useState<ServerInput>(() => serverInputFromRecord(editing))
  const [secret, setSecret] = useState('')
  const [configText, setConfigText] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const update = <K extends keyof ServerInput>(key: K, next: ServerInput[K]) => setValue((current) => ({ ...current, [key]: next }))
  const importConfig = async () => {
    try {
      const result = parseSshConfig(configText); const host = result.hosts[0]
      if (!host) { setMessage('没有找到可导入的 Host'); return }
      update('configAlias', host.alias); update('host', host.host); update('port', host.port); update('username', host.username)
      if (host.identityFile) update('privateKeyPath', host.identityFile)
      setMessage(result.warnings.length ? `已填入 ${host.alias}，另有 ${result.warnings.length} 条提示` : `已填入 ${host.alias}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败') }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try { await onSave(value, secret ? { kind: value.authType === 'private-key' ? 'private-key-passphrase' : 'password', value: secret } : undefined); onClose() }
    catch { /* parent displays the error */ } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <form className="modal" onSubmit={submit}>
      <header className="modal-header"><div><span className="eyebrow">配置入口</span><h2>{editing ? '编辑服务器' : '添加服务器'}</h2><p className="modal-subtitle">{editing ? '修改连接信息，已保存的浏览器凭据会继续保留' : '保存后可为这台服务器添加多个应用'}</p></div><button type="button" className="modal-close" onClick={onClose}>×</button></header>
      <div className="modal-body">
        <div className="mode-switch"><button type="button" className={value.source === 'manual' ? 'selected' : ''} onClick={() => update('source', 'manual')}>手写 SSH</button><button type="button" className={value.source === 'ssh-config' ? 'selected' : ''} onClick={() => update('source', 'ssh-config')}>读取 SSH Config</button></div>
        {value.source === 'ssh-config' && <div className="config-import"><textarea value={configText} onChange={(event) => setConfigText(event.target.value)} placeholder={'粘贴 ~/.ssh/config 中的 Host 配置\nHost gpu\n  HostName 10.0.0.2\n  User root'} /><button type="button" className="ghost small" onClick={() => void importConfig()}>解析并填入</button>{message && <span>{message}</span>}</div>}
        <div className="form-grid">
          <label>显示名称<input required value={value.name} onChange={(event) => update('name', event.target.value)} placeholder="例如：GPU 训练机" /></label>
          <label>主机地址<input required value={value.host} onChange={(event) => update('host', event.target.value)} placeholder="10.0.0.2 或 Host 别名" /></label>
          <label>SSH 端口<input required type="number" min="1" max="65535" value={value.port} onChange={(event) => update('port', Number(event.target.value))} /></label>
          <label>用户名<input required value={value.username} onChange={(event) => update('username', event.target.value)} placeholder="root" /></label>
          <label>认证方式<select value={value.authType} onChange={(event) => update('authType', event.target.value as ServerInput['authType'])}><option value="password">密码</option><option value="private-key">私钥文件</option><option value="ssh-config">SSH Agent / Config</option></select></label>
          <label>凭据 {secret ? <small>已填写</small> : null}<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={editing ? '留空则保留当前浏览器凭据' : '只保存到当前浏览器'} /></label>
          {value.authType === 'private-key' && <label className="wide">私钥路径<input value={value.privateKeyPath ?? ''} onChange={(event) => update('privateKeyPath', event.target.value)} placeholder="C:\\Users\\你\\.ssh\\id_ed25519" /></label>}
          <label className="wide">备注<textarea value={value.notes} onChange={(event) => update('notes', event.target.value)} placeholder="这台机器用来做什么？" /></label>
        </div>
      </div>
      <footer className="modal-footer"><span className="security-note">⌁ 凭据只保存在当前浏览器，不会写入服务端</span><button type="button" className="ghost" onClick={onClose}>取消</button><button className="primary" disabled={saving}>{saving ? '保存中…' : editing ? '保存修改' : '保存服务器'}</button></footer>
    </form>
  </div>
}
