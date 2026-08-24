// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ServerRecord } from '@ssh-launchpad/shared'
import { serverInputFromRecord } from './server-dialog-model.js'

describe('server dialog model', () => {
  it('loads an existing server record into the editable form', () => {
    const record: ServerRecord = {
      id: 'server-1', name: 'GPU', source: 'manual', host: '10.0.0.2', port: 2222, username: 'root', authType: 'password', notes: 'training',
      hostFingerprint: 'sha256:test', createdAt: 'now', updatedAt: 'now',
    }
    expect(serverInputFromRecord(record)).toEqual({ name: 'GPU', source: 'manual', host: '10.0.0.2', port: 2222, username: 'root', authType: 'password', notes: 'training' })
  })
})
