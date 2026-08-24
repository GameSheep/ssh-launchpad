import { describe, expect, it } from 'vitest'
import { parseSshConfig } from './ssh-config-parser.js'

describe('parseSshConfig', () => {
  it('imports concrete aliases and warns for unsupported blocks/directives', () => {
    const result = parseSshConfig(`
      # personal servers
      Host gpu staging
        HostName 10.0.0.2
        Port 2222
        User dev
        IdentityFile "%USERPROFILE%\\.ssh\\id_ed25519"
        ProxyJump bastion
      Host *
        User ignored
      Include ~/.ssh/config.d/*
    `)

    expect(result.hosts).toHaveLength(2)
    expect(result.hosts[0]).toMatchObject({ alias: 'gpu', host: '10.0.0.2', port: 2222, username: 'dev' })
    expect(result.hosts[0]?.identityFile).toContain('.ssh')
    expect(result.hosts[1]).toMatchObject({ alias: 'staging', host: '10.0.0.2' })
    expect(result.warnings.join('\n')).toMatch(/proxyjump/i)
    expect(result.warnings.join('\n')).toMatch(/wildcard/i)
    expect(result.warnings.join('\n')).toMatch(/include/i)
  })

  it('uses SSH defaults and preserves quoted values', () => {
    const result = parseSshConfig(`Host box\n  HostName box.internal # comment\n  IdentityFile '~/.ssh/id box'`)
    expect(result.hosts).toEqual([{
      alias: 'box', host: 'box.internal', port: 22, username: '', identityFile: expect.stringContaining('id box'),
    }])
  })
})
