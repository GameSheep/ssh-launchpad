# Server runtime

这个 workspace 包含 SSH Launchpad 的 SSH 会话、端口转发、应用运行时和 SQLite 仓储模块。生产部署只需要启动根目录的控制平面：

```bash
npm run build
npm start
```

控制平面直接导入这里的运行时模块，因此不需要在用户电脑上额外安装或运行 Agent。浏览器提交的 SSH 密码只用于当前连接，不会由本模块写入数据库；服务器记录和应用记录由控制平面保存到 `CONTROL_DATA_DIR`。

旧版本中用于本地 Agent 的底层模块仍保留在源码中，方便兼容已有测试和后续迁移，但它不是当前部署路径，也不需要配置 `PAIRING_CODE`、`AGENT_NAME` 或单独启动 `agent:start`。
