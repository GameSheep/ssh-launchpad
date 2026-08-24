import { describe, expect, it } from 'vitest'
import { openControlDatabase } from '../control-database.js'
import { AgentRegistry } from './agent-registry.js'
import { PairingService } from './pairing-service.js'

describe('PairingService', () => {
  it('creates a one-time code and pairs one Agent', () => {
    const database = openControlDatabase(':memory:'); const registry = new AgentRegistry(database); const service = new PairingService(database, registry)
    const code = service.create(); const paired = service.consume(code.code, 'Office PC')
    expect(code.code).toMatch(/^[A-F0-9]{6}$/); expect(paired.descriptor.name).toBe('Office PC'); expect(paired.token).toBeTruthy()
    expect(() => service.consume(code.code, 'Again')).toThrowError(/invalid|expired/i); database.close()
  })
})
