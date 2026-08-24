import type { RuntimeEvent } from './contracts.js'

export type AgentMethod =
  | 'bootstrap'
  | 'servers.list'
  | 'servers.create'
  | 'servers.update'
  | 'servers.remove'
  | 'servers.test'
  | 'servers.confirmFingerprint'
  | 'servers.setCredential'
  | 'servers.deleteCredential'
  | 'apps.list'
  | 'apps.create'
  | 'apps.update'
  | 'apps.remove'
  | 'apps.connect'
  | 'apps.disconnect'
  | 'apps.reconnect'
  | 'apps.logs'
  | 'apps.proxy'

export interface AgentErrorBody {
  code: string
  message: string
  details?: Record<string, unknown>
}

export interface AgentDescriptor {
  id: string
  name: string
  connected: boolean
  pairedAt: string
  lastSeen: string
}

export interface AgentPairMessage {
  type: 'pair'
  code: string
  name: string
}

export interface AgentHelloMessage {
  type: 'hello'
  agentId: string
  token: string
  name: string
}

export interface AgentRequest {
  type: 'request'
  id: string
  method: AgentMethod
  payload: unknown
}

export interface AgentSuccessResponse {
  type: 'response'
  id: string
  ok: true
  result: unknown
}

export interface AgentFailureResponse {
  type: 'response'
  id: string
  ok: false
  error: AgentErrorBody
}

export interface AgentEventMessage {
  type: 'event'
  event: RuntimeEvent
}

export type AgentMessage = AgentPairMessage | AgentHelloMessage | AgentRequest | AgentSuccessResponse | AgentFailureResponse | AgentEventMessage

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Agent message must be an object')
  return value as Record<string, unknown>
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) throw new Error(`Invalid Agent message field: ${name}`)
  return value
}

export function parseAgentMessage(value: unknown): AgentMessage {
  const data = record(value)
  const type = stringField(data.type, 'type')
  if (type === 'pair') return { type, code: stringField(data.code, 'code'), name: stringField(data.name, 'name') }
  if (type === 'hello') return { type, agentId: stringField(data.agentId, 'agentId'), token: stringField(data.token, 'token'), name: stringField(data.name, 'name') }
  if (type === 'request') return { type, id: stringField(data.id, 'id'), method: stringField(data.method, 'method') as AgentMethod, payload: data.payload }
  if (type === 'event') {
    if (!data.event || typeof data.event !== 'object') throw new Error('Invalid Agent event')
    return { type, event: data.event as RuntimeEvent }
  }
  if (type === 'response') {
    const id = stringField(data.id, 'id')
    if (data.ok === true) return { type, id, ok: true, result: data.result }
    if (data.ok === false) {
      const error = record(data.error)
      const parsed: AgentErrorBody = { code: stringField(error.code, 'error.code'), message: stringField(error.message, 'error.message') }
      if (error.details !== undefined) parsed.details = record(error.details)
      return { type, id, ok: false, error: parsed }
    }
  }
  throw new Error('Unknown Agent message type')
}
