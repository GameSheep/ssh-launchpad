# SSH Launchpad

SSH Launchpad 是一个可自部署的单体 Web 工作台：浏览器访问一个地址，服务端保存服务器和应用的快速记录，并由服务端直接建立 SSH 连接、端口转发和浏览器隧道。它适合统一打开 DeepSeek Harness、OpenClaw 或任意带 Web 界面的远程程序，不需要额外安装 Agent，也不需要把 SSH 端口暴露到公网。

## 工作方式

- 服务器地址、SSH 端口、用户名、远端端口和本地端口保存在服务端的 SQLite 数据库中。
- SSH 密码或私钥口令只保存在当前浏览器的 `localStorage`，没有过期时间，不写入服务端数据库、日志或 GitHub。
- 点击应用时，浏览器把当前服务器的凭据通过 HTTPS 发送给服务端；服务端只在本次连接需要的内存生命周期内使用它。
- 服务端通过 SSH 建立到远端 Web 应用的隧道，并以 `/tunnel/<应用 ID>/` 代理给浏览器。
- 每个应用的本地端口在服务端唯一；新增或修改应用时如果冲突会直接返回错误，不会自动改端口。

## 从 GitHub 部署

要求 Node.js `>=24.14`，或使用 Docker。

```bash
git clone https://github.com/GameSheep/ssh-launchpad.git
cd ssh-launchpad
npm install
cp .env.example .env
```

编辑 `.env`，至少设置随机的控制令牌、会话密钥和浏览器可访问的公网地址：

```dotenv
CONTROL_TOKEN=换成一段随机长令牌
SESSION_SECRET=换成另一段随机长令牌
PUBLIC_BASE_URL=https://tyyun.haibao.fun
HOST=0.0.0.0
PORT=4318
CONTROL_DATA_DIR=./.control-plane
```

启动：

```bash
npm run build
npm start
```

生产环境建议用 Nginx、Caddy 或 Cloudflare Tunnel 将 HTTPS 转发到 `127.0.0.1:4318`。不需要配置 WebSocket 转发。Docker 部署：

```bash
cp .env.example .env
# 编辑 .env
docker compose up -d --build
```

控制平面默认监听 `0.0.0.0:4318`，Docker 中的数据目录为 `/data`。请为 `/data` 配置持久化卷，否则服务器和应用记录会随容器删除而丢失。

## 第一次使用

1. 打开公网地址，输入 `CONTROL_TOKEN`。
2. 点击“添加应用”。第一次添加时可以同时填写 SSH 地址、SSH 端口、用户名、密码和应用端口；也可以在“服务器管理”中先保存服务器，再添加多个应用。
3. 应用类型可选 DeepSeek Harness、OpenClaw 或自定义 Web 程序，填写远端地址、远端端口、本地端口和可选的启动命令。
4. 点击应用图标。第一次遇到未知 SSH 主机指纹时，确认指纹后会自动继续打开原来的浏览器标签页。

密码只保存在输入它的那个浏览器配置文件中，清空站点数据或更换浏览器后需要重新输入。服务端数据库不会保存密码，因此服务端重启后仍需由浏览器在下一次连接时发送凭据。

## 安全边界

- `CONTROL_TOKEN` 是整个工作台的登录凭据，请使用高强度随机值并通过 HTTPS 访问。
- SSH 密码不会落盘到服务端，但服务端在建立 SSH 会话时会暂时持有它；请只把该服务部署在自己信任的机器上。
- 首次 SSH 主机指纹必须人工确认，指纹变化会阻止连接。
- 启动和停止命令完全由用户填写，会在远程服务器上执行；不要粘贴不信任的命令。
- `/tunnel/` 和所有 API 都需要登录会话，原始 SSH 端口和应用端口不会作为公网端口暴露。

## 验证

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
```
