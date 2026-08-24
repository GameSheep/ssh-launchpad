import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileLogStore } from './log-store.js'

describe('FileLogStore', () => {
  it('redacts secrets and keeps a bounded in-memory tail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'launchpad-log-')); const store = new FileLogStore(root)
    store.registerSecret('top-secret')
    await store.append('app', JSON.stringify({ password: 'top-secret', message: 'top-secret' }))
    expect(await store.read('app', 10)).toEqual(['{"password":[REDACTED],"message":"[REDACTED]"}'])
  })

  it('rotates archives at 1 MiB', async () => {
    const root = await mkdtemp(join(tmpdir(), 'launchpad-log-')); const store = new FileLogStore(root)
    for (let i = 0; i < 6; i += 1) await store.append('app', 'x'.repeat(1024 * 1024))
    const files = await readdir(join(root, 'app'))
    expect(files.length).toBeLessThanOrEqual(5)
  })
})
