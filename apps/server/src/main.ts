import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { openDatabase } from './db/database.js'
import { SqliteServerRepository } from './db/server-repository.js'
import { SqliteAppRepository } from './db/app-repository.js'
import { WindowsCredentialStore } from './credentials/keyring-store.js'
import { DefaultServerService } from './servers/server-service.js'
import { DefaultSshSessionFactory } from './ssh/ssh-session.js'
import { DefaultServerConnectionService } from './ssh/server-connection-service.js'
import { DefaultSessionPool } from './ssh/session-pool.js'
import { DefaultTunnelManager } from './tunnels/tunnel-manager.js'
import { InMemoryRuntimeEventBus } from './runtime/event-bus.js'
import { FileLogStore } from './runtime/log-store.js'
import { FetchHealthChecker } from './runtime/health-checker.js'
import { AppRuntimeServiceImpl } from './runtime/app-runtime-service.js'
import { AgentClient } from './agent/agent-client.js'
import { AgentRpcHandler } from './agent/agent-rpc-handler.js'

const dataRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'ssh-launchpad')
  : join(process.cwd(), '.ssh-launchpad')
const tokenPath = process.env.AGENT_TOKEN_PATH ?? join(dataRoot, 'agent-token.json')

async function createAgent() {
  await mkdir(dataRoot, { recursive: true })
  const database = openDatabase(join(dataRoot, 'launchpad.db'))
  const serversRepository = new SqliteServerRepository(database)
  const apps = new SqliteAppRepository(database)
  const credentials = new WindowsCredentialStore()
  const servers = new DefaultServerService(serversRepository, apps, credentials)
  const factory = new DefaultSshSessionFactory()
  const serverConnections = new DefaultServerConnectionService(serversRepository, credentials, factory)
  const sessions = new DefaultSessionPool(factory, credentials)
  const tunnels = new DefaultTunnelManager()
  const events = new InMemoryRuntimeEventBus()
  const logs = new FileLogStore()
  const health = new FetchHealthChecker()
  const runtime = new AppRuntimeServiceImpl({ apps, servers: serversRepository, sessions, tunnels, events, logs, health })
  const handler = new AgentRpcHandler({ servers, serverRepository: serversRepository, serverConnections, apps, runtime, events, logs, credentials })
  const controlUrl = process.env.CONTROL_URL
  if (!controlUrl) throw new Error('CONTROL_URL is required, for example wss://launchpad.example.com')
  const client = new AgentClient({
    controlUrl,
    agentName: process.env.AGENT_NAME ?? 'Windows Agent',
    tokenPath,
    handler,
    ...(process.env.PAIRING_CODE ? { pairingCode: process.env.PAIRING_CODE } : {}),
  })
  events.subscribe((event) => client.publishEvent(event))
  return { client, database, runtime }
}

async function main(): Promise<void> {
  const system = await createAgent()
  await system.client.start()
  console.log(`SSH Launchpad Agent connected as ${process.env.AGENT_NAME ?? 'Windows Agent'}`)
  const shutdown = async () => { await system.client.stop(); await system.runtime.shutdown(); system.database.close() }
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
