import type { RuntimeEvent, RuntimeSnapshot, RuntimeStatus } from '@ssh-launchpad/shared'
import type { RuntimeEventBus } from './types.js'

export class InMemoryRuntimeEventBus implements RuntimeEventBus {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>()
  private readonly snapshots = new Map<string, RuntimeSnapshot>()

  async publish(event: RuntimeEvent): Promise<void> {
    if (event.type === 'runtime') this.snapshots.set(event.snapshot.appId, event.snapshot)
    if (event.type === 'snapshot') for (const snapshot of event.snapshots) this.snapshots.set(snapshot.appId, snapshot)
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): Record<string, RuntimeStatus> {
    return Object.fromEntries([...this.snapshots].map(([appId, snapshot]) => [appId, snapshot.status]))
  }

  snapshotsList(): RuntimeSnapshot[] {
    return [...this.snapshots.values()]
  }
}

export { InMemoryRuntimeEventBus as RuntimeEventBusImpl }
