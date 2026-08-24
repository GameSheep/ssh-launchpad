import { AppRuntimeServiceImpl, DefaultServerConnectionService, DefaultSessionPool, DefaultSshSessionFactory, DefaultTunnelManager, FetchHealthChecker, InMemoryCredentialStore, InMemoryLogStore, InMemoryRuntimeEventBus, SqliteAppRepository, SqliteServerRepository, openDatabase } from './index.js'
import { buildLocalBridge } from './local-bridge.js'

async function main(): Promise<void> {
  // The browser is the source of truth. The local bridge keeps only an
  // in-memory copy for active SSH sessions and never writes config or secrets
  // to disk.
  const database = openDatabase(':memory:')
  const servers = new SqliteServerRepository(database)
  const apps = new SqliteAppRepository(database)
  const credentials = new InMemoryCredentialStore()
  const factory = new DefaultSshSessionFactory()
  const serverConnections = new DefaultServerConnectionService(servers, credentials, factory)
  const sessions = new DefaultSessionPool(factory, credentials)
  const tunnels = new DefaultTunnelManager()
  const events = new InMemoryRuntimeEventBus()
  const logs = new InMemoryLogStore()
  const health = new FetchHealthChecker()
  const runtime = new AppRuntimeServiceImpl({ apps, servers, sessions, tunnels, events, logs, health })
  const allowedOrigins = (process.env.CONTROL_ORIGIN ?? 'http://localhost:5173').split(',').map((value) => value.trim()).filter(Boolean)
  const app = await buildLocalBridge({ servers, apps, serverConnections, runtime, events, allowedOrigins })
  const host = process.env.LOCAL_BRIDGE_HOST ?? '127.0.0.1'
  const port = Number(process.env.LOCAL_BRIDGE_PORT ?? 4319)
  await app.listen({ host, port })
  console.log(`SSH Launchpad local bridge listening on http://${host}:${port}`)
  const shutdown = async () => { await app.close(); await runtime.shutdown(); database.close() }
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
