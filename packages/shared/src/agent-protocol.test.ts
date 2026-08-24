import { describe, expect, it } from 'vitest'
import { parseAgentMessage } from './agent-protocol.js'

describe('Agent protocol', () => {
  it('parses request, response, pair, hello, and event envelopes', () => {
    expect(parseAgentMessage({ type: 'pair', code: 'AB12CD', name: 'Office PC' })).toMatchObject({ type: 'pair', code: 'AB12CD' })
    expect(parseAgentMessage({ type: 'hello', agentId: 'a', token: 't', name: 'PC' })).toMatchObject({ type: 'hello', agentId: 'a' })
    expect(parseAgentMessage({ type: 'request', id: 'r', method: 'bootstrap', payload: {} })).toMatchObject({ type: 'request', method: 'bootstrap' })
    expect(parseAgentMessage({ type: 'response', id: 'r', ok: true, result: { ok: true } })).toMatchObject({ type: 'response', ok: true })
    expect(parseAgentMessage({ type: 'response', id: 'r', ok: false, error: { code: 'AGENT_TIMEOUT', message: 'timeout' } })).toMatchObject({ type: 'response', ok: false })
    expect(parseAgentMessage({ type: 'event', event: { type: 'snapshot', snapshots: [] } })).toMatchObject({ type: 'event' })
  })

  it('rejects malformed envelopes', () => {
    expect(() => parseAgentMessage(null)).toThrow()
    expect(() => parseAgentMessage({ type: 'request', id: '', method: 'bootstrap' })).toThrow()
    expect(() => parseAgentMessage({ type: 'unknown' })).toThrow()
  })
})
