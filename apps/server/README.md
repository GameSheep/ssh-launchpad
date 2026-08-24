# SSH Launchpad Agent

Agent 是本地运行时，不提供浏览器页面，也不监听 HTTP 端口。它负责读取本机 SSH config、保存凭据、建立 SSH 会话/端口转发，并通过出站 WebSocket 调用控制平面。

从项目根目录启动：

```powershell
$env:CONTROL_URL = "https://launchpad.example.com"
$env:PAIRING_CODE = "首次配对时页面生成的六位代码"
$env:AGENT_NAME = "我的 Windows"
npm run agent:start
```

首次配对成功后，令牌保存在 `%LOCALAPPDATA%\ssh-launchpad\agent-token.json`。后续启动不需要 `PAIRING_CODE`。SSH 凭据只会写入 Windows Credential Manager，数据库和日志也只在本机保存。
