import { createHash, randomUUID } from 'node:crypto'
import type { AgentDescriptor, AgentEventMessage, AgentFailureResponse, AgentMethod, AgentRequest, AgentSuccessResponse } from '@ssh-launchpad/shared'
import { LaunchpadError } from '@ssh-launchpad/shared'
import type { ControlDatabase } from '../control-database.js'

export interface AgentSocket {
  readyState: number
  send(data: string): void
  close(): void
}

type Pending = { resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }
type AgentRow = { id: string; name: string; paired_at: string; last_seen: string; revoked: number }

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }

export class AgentRegistry {
  private readonly sockets = new Map<string, AgentSocket>()
  private readonly pending = new Map<string, Pending>()
  private readonly listeners = new Set<(event: AgentEventMessage['event']) => void>()

  constructor(private readonly database: ControlDatabase) {}

  create(name: string): { descriptor: AgentDescriptor; token: string } {
    const id = randomUUID(); const token = randomUUID() + randomUUID(); const now = new Date().toISOString()
    this.database.raw.prepare('INSERT INTO agents (id, name, token_hash, paired_at, last_seen, revoked) VALUES (?, ?, ?, ?, ?, 0)').run(id, name, hash(token), now, now)
    return { descriptor: { id, name, connected: false, pairedAt: now, lastSeen: now }, token }
  }

  authenticate(id: string, token: string): AgentDescriptor | undefined {
    const row = this.database.raw.prepare('SELECT id, name, paired_at, last_seen, revoked FROM agents WHERE id = ? AND token_hash = ?').get(id, hash(token)) as AgentRow | undefined
    if (!row || row.revoked === 1) return undefined
    return this.map(row)
  }

  attach(id: string, socket: AgentSocket): void {
    this.sockets.get(id)?.close()
    this.sockets.set(id, socket)
    this.touch(id)
  }

  detach(id: string, socket?: AgentSocket): void {
    if (!socket || this.sockets.get(id) === socket) this.sockets.delete(id)
    this.touch(id)
  }

  list(): AgentDescriptor[] {
    return (this.database.raw.prepare('SELECT id, name, paired_at, last_seen, revoked FROM agents WHERE revoked = 0 ORDER BY name COLLATE NOCASE').all() as unknown as AgentRow[]).map((row) => this.map(row))
  }

  get(id: string): AgentDescriptor | undefined {
    const row = this.database.raw.prepare('SELECT id, name, paired_at, last_seen, revoked FROM agents WHERE id = ? AND revoked = 0').get(id) as AgentRow | undefined
    return row ? this.map(row) : undefined
  }

  revoke(id: string): void { this.database.raw.prepare('UPDATE agents SET revoked = 1 WHERE id = ?').run(id); this.sockets.get(id)?.close(); this.sockets.delete(id) }

  async request(agentId: string, method: AgentMethod, payload: unknown, timeoutMs = 10_000): Promise<unknown> {
    const socket = this.sockets.get(agentId)
    if (!socket || socket.readyState !== 1) throw new LaunchpadError('AGENT_OFFLINE', 'The selected Agent is offline', { agentId })
    const id = randomUUID()
    const request: AgentRequest = { type: 'request', id, method, payload }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(`${agentId}:${id}`); reject(new LaunchpadError('AGENT_TIMEOUT', 'Agent did not respond in time', { agentId, method })) }, timeoutMs)
      this.pending.set(`${agentId}:${id}`, { resolve, reject, timer })
      try { socket.send(JSON.stringify(request)) } catch (error) { clearTimeout(timer); this.pending.delete(`${agentId}:${id}`); reject(error) }
    })
  }

  accept(agentId: string, message: AgentSuccessResponse | AgentFailureResponse | AgentEventMessage): void {
    this.touch(agentId)
    if (message.type === 'event') { for (const listener of this.listeners) listener(message.event); return }
    const key = `${agentId}:${message.id}`; const pending = this.pending.get(key)
    if (!pending) return
    this.pending.delete(key); clearTimeout(pending.timer)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new LaunchpadError(message.error.code as never, message.error.message, message.error.details))
  }

  onEvent(listener: (event: AgentEventMessage['event']) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  private touch(id: string): void { this.database.raw.prepare('UPDATE agents SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), id) }
  private map(row: AgentRow): AgentDescriptor { return { id: row.id, name: row.name, connected: this.sockets.has(row.id), pairedAt: row.paired_at, lastSeen: row.last_seen } }
}
