# Server runtime and local SSH Bridge

这个 workspace 包含 SSH 会话、端口转发、应用运行时和 SQLite 仓储模块。

公网控制平面启动：

```bash
npm run build
npm start
```

需要在用户电脑上执行本地 SSH 时，启动 Bridge：

```powershell
$env:CONTROL_ORIGIN="https://tyyun.haibao.fun"
npm run local:start
```

Bridge 只监听 `127.0.0.1:4319`，接收浏览器发来的服务器/应用记录和当前凭据，在本机建立 SSH 隧道。服务器、应用、凭据和主机指纹由浏览器保存；Bridge 只在进程内存中保留运行时状态，退出后不会留下配置文件。
