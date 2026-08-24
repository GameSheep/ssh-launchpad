import { describe, expect, it } from 'vitest'
import { openControlDatabase } from '../control-database.js'
import { SqliteSessionService } from './session-service.js'

describe('SqliteSessionService', () => {
  it('exchanges the control token for an expiring session', () => {
    const database = openControlDatabase(':memory:'); const service = new SqliteSessionService(database, 'secret')
    const token = service.exchange('secret')
    expect(token).not.toBe('secret'); expect(service.verify(token)).toBe(true); expect(service.verify('wrong')).toBe(false)
    service.revoke(token); expect(service.verify(token)).toBe(false); database.close()
  })

  it('rejects an invalid control token', () => {
    const database = openControlDatabase(':memory:'); const service = new SqliteSessionService(database, 'secret')
    expect(() => service.exchange('wrong')).toThrowError(/invalid/i); database.close()
  })
})
