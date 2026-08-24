import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentGateway } from './agent-gateway.js'
import { AgentRegistry } from './agents/agent-registry.js'
import { PairingService } from './agents/pairing-service.js'
import { SqliteSessionService } from './auth/session-service.js'
import { ControlEventBus } from './control-events.js'
import { buildControlApp } from './control-app.js'
import { openControlDatabase } from './control-database.js'

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
  const database = openControlDatabase(join(dataDir, 'control.db'))
  const sessions = new SqliteSessionService(database, controlToken)
  const registry = new AgentRegistry(database)
  const pairing = new PairingService(database, registry)
  const events = new ControlEventBus()
  registry.onEvent((event) => events.publish(event))
  const gateway = new AgentGateway(registry, pairing)
  const webRoot = process.env.WEB_ROOT ?? join(fileURLToPath(new URL('.', import.meta.url)), '../../web/dist')
  const app = await buildControlApp({ sessions, registry, pairing, events, gateway, publicBaseUrl, ...(process.env.SERVE_WEB === 'false' ? {} : { webRoot }) })
  const port = Number(process.env.PORT ?? 4318)
  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen({ host, port })
  console.log(`SSH Launchpad control plane listening on ${publicBaseUrl}`)
  const shutdown = async () => { await app.close(); database.close() }
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
