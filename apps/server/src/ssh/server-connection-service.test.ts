import { describe, expect, it } from 'vitest'
import { LaunchpadError, type ServerRecord } from '@ssh-launchpad/shared'
import type { CredentialStore } from '../credentials/credential-store.js'
import type { ServerRepository } from '../db/server-repository.js'
import { DefaultServerConnectionService } from './server-connection-service.js'
import type { SshSessionFactory } from './ssh-session.js'

const server: ServerRecord = { id: 's1', name: 'one', source: 'manual', host: 'localhost', port: 22, username: 'u', authType: 'password', notes: '', createdAt: '', updatedAt: '' }

describe('DefaultServerConnectionService', () => {
  it('holds unknown fingerprints until exact confirmation', async () => {
    let saved = ''
    const servers: ServerRepository = { list: () => [server], get: () => server, create: () => server, update: () => server, setFingerprint: (_id, value) => { saved = value; return { ...server, hostFingerprint: value } }, delete: () => undefined }
    const credentials: CredentialStore = { set: async () => '', get: async () => 'pw', delete: async () => undefined }
    const factory: SshSessionFactory = { connect: async () => { throw new LaunchpadError('SSH_HOST_KEY_UNKNOWN', 'unknown', { candidateFingerprint: 'SHA256:abc' }) } }
    const service = new DefaultServerConnectionService(servers, credentials, factory)
    expect(await service.test('s1')).toEqual({ ok: false, candidateFingerprint: 'SHA256:abc' })
    expect(() => service.confirmFingerprint('s1', 'SHA256:wrong')).toThrowError(/no longer valid/)
    expect(service.confirmFingerprint('s1', 'SHA256:abc').hostFingerprint).toBe('SHA256:abc')
    expect(saved).toBe('SHA256:abc')
    expect(() => service.confirmFingerprint('s1', 'SHA256:abc')).toThrow()
  })
})
