import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
import { FileIconStore } from './icons/icon-store.js'
import { buildApp } from './app.js'

const dataRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'ssh-launchpad')
  : join(process.cwd(), '.ssh-launchpad')
const preferredPort = Number(process.env.LAUNCHPAD_PORT ?? 4318)

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function createApplication(port: number) {
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
  const icons = new FileIconStore()
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../../web/dist')
  const app = await buildApp({ servers, serverConnections, apps, runtime, events, icons, sessionToken: randomBytes(32).toString('hex'), allowedPort: port, webRoot })
  return { app, database, runtime }
}

async function main(): Promise<void> {
  let port = preferredPort
  let system = await createApplication(port)
  try {
    await system.app.listen({ host: '127.0.0.1', port })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
    await system.app.close(); system.database.close()
    port = await findFreePort()
    system = await createApplication(port)
    await system.app.listen({ host: '127.0.0.1', port })
  }
  const address = `http://127.0.0.1:${port}`
  console.log(`SSH Launchpad running at ${address}`)
  const shutdown = async () => { await system.runtime.shutdown(); await system.app.close(); system.database.close() }
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
