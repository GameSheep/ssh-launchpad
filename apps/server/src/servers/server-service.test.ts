import { describe, expect, it } from 'vitest'
import type { ServerInput, ServerRecord } from '@ssh-launchpad/shared'
import type { AppRepository } from '../db/app-repository.js'
import type { ServerRepository } from '../db/server-repository.js'
import type { CredentialStore } from '../credentials/credential-store.js'
import { DefaultServerService } from './server-service.js'

const input: ServerInput = {
  name: 'GPU', source: 'manual', host: '10.0.0.2', port: 22, username: 'dev', authType: 'password', notes: '',
}

function record(id: string, credentialId?: string): ServerRecord {
  const value: ServerRecord = { ...input, id, createdAt: 'now', updatedAt: 'now' }
  if (credentialId) value.credentialId = credentialId
  return value
}

function setup(initial = record('server-a')) {
  let current = initial
  const secrets = new Map<string, string>()
  const servers: ServerRepository = {
    list: () => [current], get: (id) => id === current.id ? current : undefined,
    create: (_input, credentialId, id = 'created') => { current = record(id, credentialId ?? undefined); return current },
    update: (id, _input, credentialId) => { current = record(id, credentialId === null ? undefined : credentialId); return current },
    setFingerprint: () => current, delete: () => { current = undefined as never },
  }
  const apps: AppRepository = { list: () => [], get: () => undefined, create: () => { throw new Error() }, update: () => { throw new Error() }, delete: () => undefined, findByLocalPort: () => undefined }
  const credentials: CredentialStore = {
    set: (serverId, kind, value) => { const id = `${serverId}:${kind}`; secrets.set(id, value); return Promise.resolve(id) },
    get: async (id) => secrets.get(id)!, delete: async (id) => { secrets.delete(id) },
  }
  return { service: new DefaultServerService(servers, apps, credentials), servers, secrets }
}

describe('DefaultServerService', () => {
  it('writes the secret before persisting its id and can clear it', async () => {
    const setupValue = setup()
    const created = await setupValue.service.create(input, { kind: 'password', value: 'secret' })
    expect(created.credentialId).toBeTruthy()
    expect(setupValue.secrets.get(created.credentialId!)).toBe('secret')
    const cleared = await setupValue.service.deleteCredential(created.id)
    expect(cleared.credentialId).toBeUndefined()
    expect(setupValue.secrets.size).toBe(0)
  })

  it('restores the previous credential if persistence fails', async () => {
    const current = record('server-a', 'server-a:password')
    const setupValue = setup(current)
    setupValue.secrets.set('server-a:password', 'old')
    setupValue.servers.update = () => { throw new Error('db failed') }
    await expect(setupValue.service.setCredential('server-a', { kind: 'password', value: 'new' })).rejects.toThrow('db failed')
    expect(setupValue.secrets.get('server-a:password')).toBe('old')
  })
})
