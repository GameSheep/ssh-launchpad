# SSH Launchpad

SSH Launchpad 是一个只在 Tailscale 网络内访问的 Web 工作台，但 SSH 隧道由你当前使用的电脑建立。这样应用最终打开的是 `http://127.0.0.1:<本地端口>/`，不会把远程服务代理成公网 `/tunnel/...` 地址。

## 架构

- Tailscale 控制平面：只提供登录页面和静态 Web，不保存服务器或应用记录。
- 本地 SSH Bridge：运行在你的电脑上，只监听 `127.0.0.1:4319`，接收页面的连接请求并用本机网络建立 SSH 端口转发。
- 浏览器：服务器、应用、密码、私钥口令和已确认的主机指纹都保存于当前浏览器 `localStorage`，连接时直接发给本机 Bridge。

浏览器不能直接执行本机 `ssh -L` 命令，因此本地 Bridge 是必须的；它不需要开放公网端口，也不需要 Agent 配对码。

## 部署 Tailscale 内网 Web

要求 Node.js `>=24.14`，或使用 Docker。

```bash
git clone https://github.com/GameSheep/ssh-launchpad.git
cd ssh-launchpad
npm install
cp .env.example .env
```

编辑 `.env`：

```dotenv
CONTROL_TOKEN=换成一段随机长令牌
SESSION_SECRET=换成另一段随机长令牌
PUBLIC_BASE_URL=https://tyyun.haibao.fun
HOST=0.0.0.0
PORT=4318
CONTROL_DATA_DIR=./.control-plane  # 仅保存登录会话，不保存工作台配置
```

启动 Web 服务：

```bash
npm run build
npm start
```

生产环境用 Nginx 或 Caddy 将 HTTPS 转发到 `127.0.0.1:4318`。Web 服务只需要在 Tailscale 网卡可访问，不需要暴露到公网；也不需要转发本地 Bridge 的 4319 端口。请让 `tyyun.haibao.fun` 只解析到 Tailscale IP，并用防火墙限制非 Tailscale 流量。

Docker 部署：

```bash
cp .env.example .env
# 编辑 .env
docker compose up -d --build
```

## 在需要执行 SSH 的电脑启动本地 Bridge

在你的 Windows 电脑上（不是公网服务器）执行一次：

```powershell
git clone https://github.com/GameSheep/ssh-launchpad.git
cd ssh-launchpad
npm install
npm run build
$env:CONTROL_ORIGIN="https://tyyun.haibao.fun"
npm run local:start
```

Bridge 必须保持运行。它只绑定本机回环地址，默认地址为 `http://127.0.0.1:4319`。如果要换端口，需要同时设置：

```powershell
$env:LOCAL_BRIDGE_PORT="5319"
```

当前页面前端默认连接 4319 端口。SSH 服务器、私钥路径和本地端口都以这台电脑为准。

## 第一次使用

1. 打开公网地址并输入 `CONTROL_TOKEN`。
2. 添加服务器和应用，填写远端端口与本地端口。
3. 确认本机 Bridge 已启动后，点击应用图标。
4. 页面会先打开一个连接中的标签页；首次出现未知 SSH 主机指纹时，在原页面确认，确认后标签页会自动跳转到配置的 `localhost:<本地端口>`。

例如应用配置本地端口为 `13080`，成功后打开：

```text
http://127.0.0.1:13080/
```

配置和密码只保存在输入它的浏览器配置文件中，不会保存到公网服务端或 Bridge 数据库。清空浏览器站点数据、更换浏览器或更换电脑后需要重新添加配置和输入密码。

## 安全边界

- 公网服务不保存服务器、应用或 SSH 凭据，只负责登录和提供前端页面。
- Bridge 只监听 `127.0.0.1`，不会对公网开放。
- `CONTROL_ORIGIN` 限制哪些网页可以调用本机 Bridge；请填写实际公网地址，不要使用 `*`。
- 首次 SSH 主机指纹保存到浏览器，指纹变化会阻止连接。
- 启动和停止命令完全由用户填写，会在远程服务器上执行；不要粘贴不信任的命令。

## 验证

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```
