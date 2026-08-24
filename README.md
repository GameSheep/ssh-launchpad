# SSH Launchpad

SSH Launchpad 是一个可自部署的“控制平面 + 本地 Agent”工作台：浏览器访问控制平面，Agent 运行在能访问 SSH 服务器的电脑上。服务器账号、密码、私钥、SSH config、主机指纹和隧道都留在 Agent 本机；控制平面只保存登录会话、Agent 配对信息和实时状态。

它适合统一启动 DeepSeek Harness、OpenClaw 或任意带 Web 界面的远程程序。应用启动后，浏览器打开控制平面的 `/tunnel/...` 地址，不需要把 SSH 端口或本地端口暴露到公网。

## 运行要求

- 控制平面：Node.js `>=24.14`，或 Docker
- Agent：运行在能访问 SSH 服务器的 Windows 电脑上，Node.js `>=24.14`
- 服务器允许 SSH 登录；每个应用的本地端口在 Agent 机器上唯一

## 从 GitHub 部署控制平面

```powershell
git clone https://github.com/GameSheep/ssh-launchpad.git
cd ssh-launchpad
npm install
Copy-Item .env.example .env
```

编辑 `.env`，至少设置一组足够随机的 `CONTROL_TOKEN`、`SESSION_SECRET`，以及浏览器能访问的 `PUBLIC_BASE_URL`：

```powershell
$env:CONTROL_TOKEN = "换成一段随机长令牌"
$env:SESSION_SECRET = "换成另一段随机长令牌"
$env:PUBLIC_BASE_URL = "https://launchpad.example.com"
npm run build
npm start
```

本地测试可以使用 `PUBLIC_BASE_URL=http://127.0.0.1:4318`。生产环境建议在前面放 HTTPS 反向代理，并把 WebSocket `/agent` 一并转发。

Docker 部署：

```powershell
Copy-Item .env.example .env
# 编辑 .env 后
docker compose up -d --build
```

控制平面默认监听 `0.0.0.0:4318`，数据保存在 `.control-plane/`（Docker 中为 `/data`）。

## 连接本地 Agent

1. 浏览器打开控制平面，输入 `CONTROL_TOKEN` 登录。
2. 点击“生成 Agent 配对码”。
3. 在能访问 SSH 服务器的电脑上下载同一个仓库，打开 PowerShell：

```powershell
$env:CONTROL_URL = "https://launchpad.example.com"
$env:PAIRING_CODE = "页面显示的六位配对码"
$env:AGENT_NAME = "我的 Windows"
npm install
npm run build
npm run agent:start
```

配对成功后，Agent 会把令牌保存到 `%LOCALAPPDATA%\ssh-launchpad\agent-token.json`。以后只需要设置 `CONTROL_URL`（不再需要配对码）并启动 Agent。Agent 断线会自动重连。

## 第一次配置

1. 在工作台添加服务器：可以手写 SSH 地址，也可以粘贴 `~/.ssh/config` 中的 `Host` 块。
2. 选择密码、私钥文件或 SSH Agent。密码和私钥口令只保存到 Agent 机器的 Windows Credential Manager，不会上传到控制平面。
3. 添加 DeepSeek Harness、OpenClaw 或自定义应用，填写远端端口和 Agent 上唯一的本地端口。
4. 如果应用未运行，勾选自动启动并填写明确的远端命令。停止命令也必须由用户明确配置。
5. 点击应用图标。首次遇到未知主机指纹时确认指纹，确认窗口会自动关闭，原标签页继续连接。

DSH 示例：远端端口 `3080`、本地端口 `13080`，启动命令按实际部署填写，例如 `python -m deepseek_harness --port 3080`。OpenClaw 和其他 Web 服务使用同样的 SSH 端口转发流程。

## 数据和安全

- Agent 数据库：`%LOCALAPPDATA%\ssh-launchpad\launchpad.db`
- Agent 图标和日志：`%LOCALAPPDATA%\ssh-launchpad\icons`、`%LOCALAPPDATA%\ssh-launchpad\logs`
- Agent 令牌：`%LOCALAPPDATA%\ssh-launchpad\agent-token.json`
- 控制平面不接触 SSH 凭据；Agent 只通过出站 WebSocket 连接控制平面
- 原始 SSH 端口和应用本地端口不会作为公网端口暴露；公网只提供经过浏览器会话保护的应用 HTTP Relay
- 首次 SSH 主机指纹必须确认，指纹变化会阻止连接
- 启动/停止命令完全由用户配置，不会根据远端输出或网页内容自动生成

## 验证

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run build
```
