import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppRuntimeServiceImpl, DefaultServerConnectionService, DefaultServerService, DefaultSessionPool, DefaultSshSessionFactory, DefaultTunnelManager, FetchHealthChecker, FileLogStore, InMemoryRuntimeEventBus, SqliteAppRepository, SqliteServerRepository, openDatabase } from '@ssh-launchpad/server'
import { SqliteSessionService } from './auth/session-service.js'
import { buildControlApp } from './control-app.js'
import { openControlDatabase } from './control-database.js'
import { EphemeralCredentialStore } from './ephemeral-credentials.js'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main(): Promise<void> {
  const controlToken = required('CONTROL_TOKEN')
  required('SESSION_SECRET')
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? '4318'}`
  const dataDir = process.env.CONTROL_DATA_DIR ?? join(process.cwd(), '.control-plane')
  const controlDatabase = openControlDatabase(join(dataDir, 'control.db'))
  // SSH workspace records belong to each browser. Keep the legacy runtime
  // repositories in memory only so the control plane never writes them to
  // its deployment directory.
  const runtimeDatabase = openDatabase(':memory:')
  const credentials = new EphemeralCredentialStore()
  const serverRepository = new SqliteServerRepository(runtimeDatabase)
  const appRepository = new SqliteAppRepository(runtimeDatabase)
  const servers = new DefaultServerService(serverRepository, appRepository, credentials)
  const factory = new DefaultSshSessionFactory()
  const serverConnections = new DefaultServerConnectionService(serverRepository, credentials, factory)
  const sessionsPool = new DefaultSessionPool(factory, credentials)
  const tunnels = new DefaultTunnelManager()
  const events = new InMemoryRuntimeEventBus()
  const logs = new FileLogStore(join(dataDir, 'logs'))
  const health = new FetchHealthChecker()
  const runtime = new AppRuntimeServiceImpl({ apps: appRepository, servers: serverRepository, sessions: sessionsPool, tunnels, events, logs, health })
  const sessions = new SqliteSessionService(controlDatabase, controlToken)
  const webRoot = process.env.WEB_ROOT ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')
  const app = await buildControlApp({ sessions, servers, serverConnections, apps: appRepository, runtime, events, credentials, publicBaseUrl, ...(process.env.SERVE_WEB === 'false' ? {} : { webRoot }) })
  const port = Number(process.env.PORT ?? 4318)
  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen({ host, port })
  console.log(`SSH Launchpad single-server control plane listening on ${publicBaseUrl}`)
  const shutdown = async () => { await app.close(); await runtime.shutdown(); controlDatabase.close(); runtimeDatabase.close() }
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
