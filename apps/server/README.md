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

Bridge 只监听 `127.0.0.1:4319`，接收浏览器发来的服务器/应用记录和当前凭据，在本机建立 SSH 隧道。凭据只在进程内存中使用，不写入本地数据库；主机指纹和应用运行记录可以保存在 `LOCAL_BRIDGE_DATA_DIR`。
