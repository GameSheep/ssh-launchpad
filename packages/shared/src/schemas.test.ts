import { describe, expect, it } from 'vitest'
import { remoteAppInputSchema, serverInputSchema } from './schemas.js'

describe('serverInputSchema', () => {
  it('rejects a password server without username', () => {
    const result = serverInputSchema.safeParse({
      name: 'GPU', source: 'manual', host: '10.0.0.2', port: 22,
      username: '', authType: 'password', notes: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('remoteAppInputSchema', () => {
  it('requires a start command when autoStart is enabled', () => {
    const result = remoteAppInputSchema.safeParse({
      serverId: crypto.randomUUID(), name: 'DSH', type: 'dsh',
      remoteHost: '127.0.0.1', remotePort: 3080, localPort: 13080,
      protocol: 'http', healthPath: '/', autoStart: true,
      workingDirectory: '', startCommand: '', stopOnDisconnect: false,
      stopCommand: '', iconKind: 'letter', iconValue: 'DS',
      startTimeoutMs: 30_000, healthTimeoutMs: 10_000,
    })
    expect(result.success).toBe(false)
  })
})
