# SSH Launchpad 设计规格

日期：2026-08-24

状态：已完成对话评审，等待书面规格最终确认

## 1. 背景

用户在多台服务器上运行 DeepSeek Harness、OpenClaw 和其他带 Web UI 的程序。当前访问方式依赖手工执行 SSH 本地端口转发，再在浏览器中打开对应的本地地址。服务器的 SSH 认证方式不统一：部分服务器已配置在本机 SSH Config 中，部分需要手动填写地址、账号和密码。

DeepSeek Harness 的 Web UI 默认监听 `127.0.0.1:3080`，其官方文档也明确将 SSH 场景下的本地转发交给 SSH 客户端处理。SSH Launchpad 不重新实现这些远端程序，而是提供统一、安全、可持久化的一键访问入口。

## 2. 产品目标

SSH Launchpad 是仅在 Windows 本机运行的 Web 应用。用户启动本地服务后，通过浏览器导航主页管理服务器和远端应用，并可通过一次点击完成以下操作：

1. 读取已保存的 SSH 凭据。
2. 连接或复用 SSH 会话。
3. 按需启动远端应用。
4. 建立固定的本地端口转发。
5. 检查应用是否可用。
6. 在新标签页中打开本地映射地址。

产品的主要成功标准是：服务器和应用首次配置完成后，后续访问不再需要手写 SSH 命令、重复输入密码或记忆端口。

## 3. 首版范围

### 3.1 包含

- Windows 本机运行的 Node.js 服务与浏览器管理页。
- 手动添加服务器。
- 导入常见 SSH Config 字段。
- 密码认证、无口令私钥和带口令私钥。
- 使用 Windows Credential Manager 持久化密码和私钥口令。
- 每台服务器配置多个远端 Web 应用。
- 固定本地端口、编辑时检查冲突、连接前再次检查冲突。
- 按应用配置是否自动执行远端启动命令。
- 建立、断开和重连 SSH 本地转发。
- 主机指纹首次确认与变更告警。
- DeepSeek Harness、OpenClaw 和自定义应用模板。
- 搜索、服务器分组、应用图标和连接状态。
- 本次运行日志及敏感信息脱敏。

### 3.2 不包含

- 对外提供局域网或公网访问。
- 多用户、团队共享或云同步。
- Linux 和 macOS 本地客户端。
- 纯浏览器扩展。
- 复杂 SSH Config 功能，如 `ProxyJump`、通配符组合与递归 `Include`。
- 自动扫描服务器并发现未知 Web 服务。
- 在服务器上自动安装 DeepSeek Harness、OpenClaw、Node.js 或其他依赖。
- 原生桌面窗口、系统托盘和安装包；这些可以在核心流程稳定后增加。

端口转发适用于任何兼容 SSH 的远端系统。自动启动和停止命令首版按 Linux/POSIX shell 行为设计。

## 4. 方案选择

### 4.1 选定方案：本地 Web 应用

浏览器只负责界面，本机 Node.js 服务负责 SSH、凭据、端口监听和进程生命周期。服务仅绑定 `127.0.0.1`，启动后自动打开管理页面。

该方案比 Electron 更轻量，比“浏览器扩展 + Native Messaging”更容易安装和维护，同时保留以后打包为桌面程序的可能性。

### 4.2 未选择方案

- Electron：首版体积和打包复杂度过高。
- 浏览器扩展：浏览器无法直接安全执行 SSH，仍需额外本地程序。
- 远端集中式控制台：会扩大凭据暴露面，也不符合仅供当前电脑使用的约束。

## 5. 系统架构

```text
浏览器导航页
  │ REST + Server-Sent Events
  ▼
Fastify 本地服务（127.0.0.1）
  ├─ Server Service        服务器与 SSH Config
  ├─ App Service           远端应用配置与模板
  ├─ Credential Store      Windows Credential Manager 适配器
  ├─ SSH Session Manager   认证、指纹、复用、保活、远端命令
  ├─ Tunnel Manager        本地监听、转发、冲突与重连
  ├─ Health Checker        远端端口与 HTTP(S) 健康检查
  ├─ Runtime Event Bus     状态与日志事件
  └─ Repository            SQLite 持久化
       │
       ▼
一台或多台远端 SSH 服务器
  └─ DSH / OpenClaw / 自定义 Web UI
```

组件边界如下：

- Server Service 只管理服务器配置，不持有活动连接。
- Credential Store 只通过凭据 ID 存取秘密，不暴露存储实现给其他模块。
- SSH Session Manager 为每台服务器维护至多一个共享会话，并向 Tunnel Manager 提供转发接口。
- Tunnel Manager 拥有本地监听器和应用级运行状态；它不解析表单或直接访问数据库。
- App Service 编排“检测、启动、转发、健康检查、打开”流程。
- Runtime Event Bus 将状态单向推送给前端；前端不自行推断连接状态。

## 6. 技术栈

- Node.js 24.14 LTS 或更高版本作为运行时，TypeScript 作为前后端统一语言。
- React + Vite 实现浏览器页面。
- Fastify 提供本地 REST API 和静态文件服务。
- Server-Sent Events 推送连接状态与日志，不引入 WebSocket。
- `ssh2` 负责 SSH 密码/私钥认证、远端命令、主机指纹和 TCP 转发。
- Node.js 内置 `node:sqlite` 保存非敏感数据。
- `@napi-rs/keyring` 通过预编译的 Windows 原生绑定访问 Windows Credential Manager。Credential Store 对业务层隐藏该依赖；原生绑定不可用时保存操作失败，不降级到明文或自制加密文件。

代码采用单仓库、单 Node.js workspace。前端、后端和共享契约分目录管理，但不拆分为微服务或多个发布包。

## 7. 数据存储

应用数据默认放在 `%LOCALAPPDATA%\ssh-launchpad\`：

```text
ssh-launchpad/
├─ launchpad.db       SQLite 配置库
├─ icons/             用户上传的应用图标
└─ logs/              轮转后的脱敏运行日志
```

数据库不保存密码、私钥内容或私钥口令，只保存 Windows Credential Manager 中条目的凭据 ID。条目的 service 固定为 `ssh-launchpad`，account 使用服务器 UUID 与秘密类型组合，避免用户名变更导致凭据丢失。删除服务器时同步删除对应凭据；删除应用不删除服务器凭据。

### 7.1 Server

| 字段 | 含义 |
|---|---|
| `id` | 稳定 UUID |
| `name` | 页面显示名称 |
| `source` | `manual` 或 `ssh-config` |
| `configAlias` | SSH Config Host 别名，可空 |
| `host` | 主机名或 IP |
| `port` | SSH 端口，默认 22 |
| `username` | SSH 用户名 |
| `authType` | `password`、`private-key` 或 `ssh-config` |
| `credentialId` | 密码或私钥口令引用，可空 |
| `privateKeyPath` | 私钥路径，可空 |
| `hostFingerprint` | 已确认的 SHA-256 主机指纹，可空 |
| `notes` | 非敏感备注 |
| `createdAt` / `updatedAt` | 时间戳 |

SSH Config 首版解析 `Host`、`HostName`、`Port`、`User` 和首个 `IdentityFile`。导入过程展示解析结果，保存别名和解析快照，但不修改原始配置文件。

### 7.2 RemoteApp

| 字段 | 含义 |
|---|---|
| `id` | 稳定 UUID |
| `serverId` | 所属服务器 |
| `name` | 应用名称 |
| `type` | `dsh`、`openclaw` 或 `custom` |
| `remoteHost` | 远端目标地址，默认 `127.0.0.1` |
| `remotePort` | 远端服务端口 |
| `localPort` | 固定本地端口，全局唯一 |
| `protocol` | `http` 或 `https` |
| `healthPath` | 健康检查路径，默认 `/` |
| `autoStart` | 连接时是否允许自动启动 |
| `workingDirectory` | 远端工作目录，可空 |
| `startCommand` | 远端启动命令，可空 |
| `stopOnDisconnect` | 断开时是否执行停止命令，默认 false |
| `stopCommand` | 显式停止命令，可空 |
| `iconKind` | `preset`、`url`、`upload` 或 `letter` |
| `iconValue` | 图标标识、URL、文件引用或缩写 |
| `createdAt` / `updatedAt` | 时间戳 |

DeepSeek Harness 模板预填远端端口 `3080` 与启动命令 `npx @deepseek-ai/dsh web --no-open`。模板值可以修改。

### 7.3 RuntimeState

运行状态只保存在内存中，不作为持久配置：

- `disconnected`
- `checking`
- `connecting`
- `starting`
- `tunneling`
- `healthy`
- `conflict`
- `error`

每个运行状态同时保存活动 SSH 会话引用、本地监听器、是否由本次流程启动远端程序、最近错误和脱敏日志缓冲区。

## 8. 页面设计

页面采用用户确认的“个人导航主页”布局：

- 全屏背景与居中的时间、日期。
- 顶部搜索栏，可按服务器、应用名或本地端口过滤。
- 搜索栏下方用标签切换“全部应用”及各台服务器。
- 页面主体显示少量连接概况和应用图标矩阵。
- 应用图标右上角状态点表达连接状态。
- 添加和编辑应用使用居中的深色配置弹窗。
- 小屏幕上应用网格自动减少列数，配置表单改为单列。

状态色约定：

- 灰色：未连接。
- 蓝色动画：检查、连接或启动中。
- 绿色：隧道和健康检查均正常。
- 黄色：本地端口冲突或需要用户操作。
- 红色：认证、SSH、启动或健康检查失败。

应用操作：

- 点击绿色应用：直接打开本地映射 URL。
- 点击灰色应用：连接，成功后自动打开。
- 点击黄色或红色应用：显示具体问题和可执行操作。
- 应用菜单：连接、打开、断开、重连、编辑、查看日志、删除。

## 9. 核心流程

### 9.1 添加服务器

1. 用户选择“手动配置”或“导入 SSH Config”。
2. 手动配置填写主机、端口、用户名和认证方式。
3. 密码或私钥口令提交到后端后立即写入 Windows Credential Manager；前端随后只显示“已保存”。
4. 后端测试 TCP 与 SSH 连接。
5. 首次连接展示主机 SHA-256 指纹，用户确认后写入 Server。
6. 保存服务器。

### 9.2 添加应用

1. 选择服务器和应用模板。
2. 填写远端端口与固定本地端口。
3. 编辑时检查数据库中的全局端口唯一性。
4. 选择是否自动启动；开启时填写启动命令，可选工作目录。
5. 选择图标并保存。

数据库唯一约束避免两个应用配置相同本地端口，但连接前仍必须实际绑定端口，以发现外部程序占用。

### 9.3 一键连接并打开

1. Tunnel Manager 尝试在 `127.0.0.1:<localPort>` 上预绑定，失败则进入 `conflict`。
2. Credential Store 取回秘密并交给 SSH Session Manager。
3. SSH Session Manager 建立或复用会话，校验已保存的主机指纹。
4. 通过 SSH 转发探测 `remoteHost:remotePort`，避免依赖远端的 `netstat` 或 `nc`。
5. 若端口未监听且 `autoStart=true`，在配置的工作目录中通过 POSIX `nohup sh -lc` 分离执行用户配置的启动命令，记录返回的 PID 和远端启动日志位置，然后按超时策略轮询远端端口。工作目录作为独立参数进行安全引用，不与命令字符串拼接。
6. 若端口未监听且 `autoStart=false`，进入 `error` 并提示远端服务未运行。
7. 启动正式本地监听器，将每个本地 TCP 连接通过 SSH 转发到远端目标。
8. 通过本地映射 URL 执行 HTTP(S) 健康检查。
9. 成功后进入 `healthy`，API 返回可打开的 `http(s)://127.0.0.1:<localPort>`。
10. 前端在用户点击图标的同步事件中先打开空白标签页；连接成功后将该标签页导航至本地映射 URL，失败时关闭空白标签页并显示错误，从而避免异步请求完成后被浏览器弹窗策略拦截。

远端启动等待默认上限为 30 秒；健康检查默认上限为 10 秒。这两个值在高级设置中允许按应用调整。

### 9.4 断开

1. 停止接受新的本地连接并关闭活动转发流。
2. 如果该服务器没有其他活动应用，则关闭共享 SSH 会话。
3. 只有同时满足以下条件才执行停止命令：
   - `stopOnDisconnect=true`；
   - 本次 Launchpad 连接流程确实执行过启动命令；
   - 用户配置了显式 `stopCommand`。
4. 不通过猜测 PID 或进程名杀死远端程序。

### 9.5 断线重连

活动 SSH 会话意外断开时，相关应用统一进入 `connecting`。系统在 1 秒、3 秒和 10 秒后最多重试三次。重连成功后恢复原有隧道并重新健康检查；三次失败后进入 `error`，等待用户手动重连。

## 10. 本地 API

API 使用结构化 JSON，主要资源如下：

```text
GET    /api/bootstrap
GET    /api/servers
POST   /api/servers
PATCH  /api/servers/:id
DELETE /api/servers/:id
POST   /api/servers/:id/test
POST   /api/servers/import-ssh-config

GET    /api/apps
POST   /api/apps
PATCH  /api/apps/:id
DELETE /api/apps/:id
POST   /api/apps/:id/connect
POST   /api/apps/:id/disconnect
POST   /api/apps/:id/reconnect
GET    /api/apps/:id/logs

PUT    /api/servers/:id/credential
DELETE /api/servers/:id/credential
GET    /api/events
```

`GET /api/events` 是 Server-Sent Events 连接，推送应用状态和脱敏日志事件。秘密写入接口从不回显秘密。

## 11. 安全设计

- HTTP 服务只绑定 `127.0.0.1`。
- 本地转发监听器只绑定 `127.0.0.1`。
- 服务启动时生成随机会话令牌，通过安全的 HttpOnly、SameSite Cookie 绑定当前浏览器会话。
- API 校验 `Host` 与 `Origin`，拒绝 DNS rebinding、跨站表单和非本机来源。
- 修改和执行类请求要求会话令牌，并只接受 JSON。
- 主机指纹默认拒绝未知值；首次确认是唯一的信任建立入口。
- 指纹变化始终阻止连接，不能通过自动重试绕过。
- 密码和私钥口令只在认证所需的最短生命周期内存在于内存。
- 私钥文件只读取用户明确选择的路径，不复制进数据库。
- 日志按字段脱敏，禁止记录认证对象、请求中的秘密字段和完整环境变量。
- 用户配置的启动和停止命令具有远端代码执行能力，界面必须明确标注；系统不从网页搜索结果或远端返回内容自动生成并执行命令。

管理服务优先尝试固定端口；如果该端口被占用，则选择空闲端口并打开实际地址。应用隧道端口不会自动改号。

## 12. 错误处理

错误使用稳定错误码和用户可读消息：

- `LOCAL_PORT_IN_USE`
- `SSH_AUTH_FAILED`
- `SSH_HOST_KEY_UNKNOWN`
- `SSH_HOST_KEY_CHANGED`
- `SSH_CONNECTION_FAILED`
- `REMOTE_PORT_CLOSED`
- `REMOTE_START_FAILED`
- `REMOTE_START_TIMEOUT`
- `TUNNEL_FAILED`
- `HEALTH_CHECK_FAILED`
- `CREDENTIAL_UNAVAILABLE`

页面显示简短原因、建议操作和“查看日志”。原始错误保留在脱敏日志中，不将库内部堆栈直接展示给普通用户。

## 13. 生命周期

- 启动：打开数据库、执行迁移、清理上次异常退出留下的运行标记、启动本地 API、打开浏览器。
- 正常关闭：停止 SSE、关闭本地监听器和 SSH 会话，再关闭数据库。
- 异常退出：操作系统会释放本地监听端口；下次启动不假设任何隧道仍然存在。
- 远端应用默认不随 Launchpad 关闭而停止。
- 日志采用大小轮转，默认最多保留 5 个 1 MiB 文件。

## 14. 测试策略

### 14.1 单元测试

- Server 与 RemoteApp 校验。
- 本地端口全局唯一约束。
- SSH Config 常见字段解析。
- 状态机合法与非法转换。
- 重试时间与终止条件。
- 日志脱敏。
- 启动、停止命令执行条件。

### 14.2 集成测试

使用进程内测试 SSH Server 覆盖：

- 密码、私钥和带口令私钥认证。
- 正确和错误主机指纹。
- 远端命令成功、非零退出和超时。
- 远端端口探测与双向 TCP 转发。
- 多个应用复用同一 SSH 会话。
- SSH 断线和三次重连。

### 14.3 API 与安全测试

- 非本机 Host、非法 Origin 和缺失会话令牌被拒绝。
- 重复连接请求具有幂等行为。
- 连接中删除配置被拒绝。
- 删除服务器前必须断开并删除或迁移所属应用。
- 凭据接口不回显秘密。

### 14.4 浏览器端到端测试

- 添加手动服务器。
- 导入 SSH Config。
- 添加、编辑和删除应用。
- 搜索和服务器分组过滤。
- 连接、自动打开、断开和重连。
- 端口冲突、认证失败、指纹变化和健康检查失败提示。
- 配置弹窗在桌面与窄屏下可用。

### 14.5 Windows 实机验证

- Windows Credential Manager 保存、读取和删除。
- 程序重启后无需重新输入密码。
- Windows OpenSSH 常见私钥路径和文件权限。
- 浏览器自动打开与服务关闭清理。

## 15. 验收标准

首版完成必须同时满足：

1. 用户可添加至少三台使用不同认证方式的服务器。
2. 用户可为每台服务器添加多个固定端口应用。
3. 重启 Launchpad 后服务器、应用和凭据仍可用。
4. 点击已配置应用可完成 SSH 连接、可选远端启动、端口转发和浏览器打开。
5. 本地端口冲突在建立 SSH 前被识别并清楚展示。
6. 未经确认的主机指纹和发生变化的指纹不能连接。
7. 数据库和日志中不存在密码或私钥口令明文。
8. 同一服务器的多个活动应用复用一个 SSH 会话。
9. 关闭 Launchpad 后本地隧道全部释放，远端应用默认保持运行。
10. 主页视觉结构与已确认的导航页草图一致。

## 16. 参考资料

- DeepSeek Harness Web UI 指南：https://deepseek-harness.github.io/deepseek-harness/guide/quickstart
- DeepSeek Harness README：https://github.com/deepseek-ai/deepseek-harness/blob/master/README.zh.md
- ssh2：https://github.com/mscdex/ssh2
- Fastify TypeScript：https://fastify.dev/docs/latest/Reference/TypeScript/
- Node.js SQLite：https://nodejs.org/api/sqlite.html
- Windows Credential Manager：https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/credstores.md
- `@napi-rs/keyring`：https://www.npmjs.com/package/@napi-rs/keyring
