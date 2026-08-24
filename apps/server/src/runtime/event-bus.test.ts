import { describe, expect, it } from 'vitest'
import { InMemoryRuntimeEventBus } from './event-bus.js'

describe('InMemoryRuntimeEventBus', () => {
  it('publishes, snapshots, and unsubscribes', async () => {
    const bus = new InMemoryRuntimeEventBus(); const events: string[] = []
    const off = bus.subscribe((event) => { if (event.type === 'runtime') events.push(event.snapshot.status) })
    await bus.publish({ type: 'runtime', snapshot: { appId: 'a', status: 'healthy', startedByLaunchpad: false, updatedAt: '' } })
    off()
    await bus.publish({ type: 'runtime', snapshot: { appId: 'a', status: 'disconnected', startedByLaunchpad: false, updatedAt: '' } })
    expect(events).toEqual(['healthy']); expect(bus.snapshot()).toEqual({ a: 'disconnected' })
  })
})
