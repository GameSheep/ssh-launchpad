import { useState, type FormEvent } from 'react'
import { ApiClientError } from '../api/client.js'
import { useLaunchpad } from '../state/launchpad-store.js'

export function ControlLogin() {
  const { login } = useLaunchpad()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    try { await login(token) } catch (error) { setMessage(error instanceof ApiClientError ? error.message : '无法连接控制平面') } finally { setBusy(false) }
  }
  return <main className="control-shell"><section className="control-card"><div className="brand-mark">⌁</div><span className="eyebrow">CONTROL PLANE</span><h1>登录 SSH <i>Launchpad</i></h1><p>输入部署时设置的 CONTROL_TOKEN。服务器、应用和 SSH 凭据都会保存在当前浏览器，不会保存到服务端。</p><form onSubmit={submit}><label>控制令牌<input autoFocus required type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="CONTROL_TOKEN" /></label>{message && <div className="control-message">{message}</div>}<button className="primary" disabled={busy}>{busy ? '验证中…' : '进入工作台'}</button></form></section></main>
}
