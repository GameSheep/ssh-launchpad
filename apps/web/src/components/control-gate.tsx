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
  return <main className="control-shell"><section className="control-card"><div className="brand-mark">⌁</div><span className="eyebrow">CONTROL PLANE</span><h1>登录 SSH <i>Launchpad</i></h1><p>输入部署时设置的 CONTROL_TOKEN。控制平面只保存会话，SSH 凭据始终留在你的 Agent 机器上。</p><form onSubmit={submit}><label>控制令牌<input autoFocus required type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="CONTROL_TOKEN" /></label>{message && <div className="control-message">{message}</div>}<button className="primary" disabled={busy}>{busy ? '验证中…' : '进入工作台'}</button></form></section></main>
}

export function AgentSetup() {
  const { createPairingCode, refresh } = useLaunchpad()
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string }>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const create = async () => { setBusy(true); setMessage(''); try { setPairing(await createPairingCode()) } catch (error) { setMessage(error instanceof Error ? error.message : '配对码生成失败') } finally { setBusy(false) } }
  const origin = window.location.origin
  const command = pairing ? `$env:CONTROL_URL="${origin}"; $env:PAIRING_CODE="${pairing.code}"; npm install; npm run build; npm run agent:start` : ''
  return <main className="control-shell"><section className="control-card agent-card"><div className="brand-mark">⌁</div><span className="eyebrow">AGENT SETUP</span><h1>连接你的第一台 <i>Agent</i></h1><p>Agent 运行在能访问 SSH 服务器的电脑上。它会主动连接控制平面，浏览器不需要暴露 SSH 端口或本地端口。</p>{pairing ? <><div className="pairing-code">{pairing.code}</div><p className="pairing-expiry">配对码有效至 {new Date(pairing.expiresAt).toLocaleTimeString()}</p><label>在下载的项目目录打开 PowerShell，运行：<code className="setup-command">{command}</code></label><div className="control-actions"><button className="ghost" onClick={() => void refresh()}>刷新连接状态</button><button className="primary" onClick={() => void create()}>重新生成</button></div></> : <button className="primary" disabled={busy} onClick={() => void create()}>{busy ? '生成中…' : '生成 Agent 配对码'}</button>}{message && <div className="control-message">{message}</div>}<small className="security-note">每个配对码只能使用一次，SSH 账号密码不会上传。</small></section></main>
}
