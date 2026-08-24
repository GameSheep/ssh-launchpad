import type { LogStore } from './types.js'

const MAX_LINES = 200

/** Runtime logs for the local bridge only; never written to disk. */
export class InMemoryLogStore implements LogStore {
  private readonly values = new Map<string, string[]>()

  async append(appId: string, line: string): Promise<void> {
    const lines = this.values.get(appId) ?? []
    lines.push(line)
    while (lines.length > MAX_LINES) lines.shift()
    this.values.set(appId, lines)
  }

  async read(appId: string, limit: number): Promise<string[]> {
    const lines = this.values.get(appId) ?? []
    return lines.slice(Math.max(0, lines.length - limit))
  }
}

