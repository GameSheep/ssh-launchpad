import type { RuntimeEvent, RuntimeSnapshot, RuntimeStatus } from '@ssh-launchpad/shared'

export interface RuntimeEventBus {
  publish(event: RuntimeEvent): Promise<void>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  snapshot(): Record<string, RuntimeStatus>
  snapshotsList?(): RuntimeSnapshot[]
}

export interface LogStore {
  append(appId: string, line: string): Promise<void>
  read(appId: string, limit: number): Promise<string[]>
}

export interface HealthChecker {
  check(url: string, timeoutMs: number): Promise<void>
}

export interface ConnectResult { url: string; status: 'healthy' }

export interface AppRuntimeService {
  connect(appId: string, credential?: string): Promise<ConnectResult>
  disconnect(appId: string): Promise<void>
  reconnect(appId: string, credential?: string): Promise<ConnectResult>
  getLogs(appId: string): Promise<string[]>
  shutdown(): Promise<void>
}
