import type { FastifyInstance } from 'fastify'
import type { RuntimeEvent } from '@ssh-launchpad/shared'
import type { RuntimeEventBus } from '../runtime/types.js'

function writeEvent(raw: NodeJS.WritableStream, event: RuntimeEvent): void {
  const name = event.type === 'runtime' ? 'runtime' : event.type
  raw.write(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`)
}

export async function registerEventsRoute(app: FastifyInstance, events: RuntimeEventBus): Promise<void> {
  app.get('/api/events', async (_request, reply) => {
    reply.hijack()
    const raw = reply.raw
    raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    const initial = events.snapshotsList?.() ?? Object.entries(events.snapshot()).map(([appId, status]) => ({ appId, status, startedByLaunchpad: false, updatedAt: new Date().toISOString() }))
    writeEvent(raw, { type: 'snapshot', snapshots: initial })
    const unsubscribe = events.subscribe((event) => writeEvent(raw, event))
    const heartbeat = setInterval(() => raw.write(': heartbeat\n\n'), 15_000)
    reply.raw.on('close', () => { clearInterval(heartbeat); unsubscribe() })
  })
}
