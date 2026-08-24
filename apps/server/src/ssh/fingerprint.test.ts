import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openSshFingerprint } from './fingerprint.js'

describe('openSshFingerprint', () => {
  it('uses OpenSSH SHA256 format without padding', () => {
    const key = Buffer.from('host-key')
    const expected = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`
    expect(openSshFingerprint(key)).toBe(expected)
    expect(openSshFingerprint(key)).not.toContain('=')
  })
})
