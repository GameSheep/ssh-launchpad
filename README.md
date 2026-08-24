# SSH Launchpad

一个运行在 Windows 本机的 SSH 应用启动台。它把服务器、远端程序和本地端口映射保存下来，点击应用图标后自动完成 SSH 连接、远端探活/启动、本地隧道和浏览器打开。

## 运行要求

- Windows 10/11
- Node.js `>=24.14`
- 服务器需要允许 SSH 登录；本地端口必须没有被其他程序占用

## 安装与启动

```powershell
npm install
npm run build
npm start
```

默认访问 `http://127.0.0.1:4318`。如果该端口被占用，程序会选择空闲端口并在终端输出实际地址。也可以通过 `LAUNCHPAD_PORT` 指定首选端口：

```powershell
$env:LAUNCHPAD_PORT = "4321"
npm start
```

开发模式：

```powershell
npm run dev
```

## 第一次使用

1. 点击“添加服务器”，手写 SSH 地址，或粘贴 `~/.ssh/config` 中的 `Host` 块。
2. 选择密码、私钥文件或 SSH Agent。密码和私钥口令不会写入 SQLite，而是保存到 Windows Credential Manager。
3. 为服务器添加应用：选择 DSH、OpenClaw 或自定义类型，填写远端端口和一个唯一的本地端口。
4. 如果应用未运行，勾选自动启动并填写明确的远端命令。断开时是否停止程序也必须配置显式停止命令。
5. 点击图标。浏览器会先打开空白标签，连接成功后跳转到 `127.0.0.1:<localPort>`。

DSH 示例：远端端口 `3080`，本地端口 `13080`，启动命令可以是项目实际使用的命令，例如 `python -m deepseek_harness --port 3080`。OpenClaw 和其他 Web 服务使用同样的端口转发流程。

## SSH Config 支持范围

首版导入 `Host`、`HostName`、`Port`、`User` 和第一个 `IdentityFile`。会明确提示但不会执行 `Include`、通配符 `Host *` 或 `ProxyJump`。复杂跳板链请先在本机建立可用的 SSH Agent/转发配置。

## 数据和安全

- 配置数据库：`%LOCALAPPDATA%\ssh-launchpad\launchpad.db`
- 图标：`%LOCALAPPDATA%\ssh-launchpad\icons`
- 脱敏日志：`%LOCALAPPDATA%\ssh-launchpad\logs`
- HTTP 服务和本地隧道都只监听 `127.0.0.1`
- 首次 SSH 主机指纹必须通过“测试连接 → 确认指纹”，指纹变化会硬阻止连接
- 启动/停止命令完全由用户配置，系统不会从远端输出或网页内容自动生成命令

验证 Windows Credential Manager（不会打印秘密）：

```powershell
npm run credential:verify
```

## 验证命令

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

## 稳定错误码

常见错误包括 `LOCAL_PORT_IN_USE`、`SSH_AUTH_FAILED`、`SSH_HOST_KEY_UNKNOWN`、`SSH_HOST_KEY_CHANGED`、`REMOTE_PORT_CLOSED`、`REMOTE_START_TIMEOUT` 和 `HEALTH_CHECK_FAILED`。界面会显示可操作的中文提示，API 始终返回结构化 `{ error: { code, message, details } }`。
