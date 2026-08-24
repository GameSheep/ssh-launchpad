import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FileIconStore } from './icon-store.js'

describe('FileIconStore', () => {
  it('validates magic bytes and stores supported image formats', async () => {
    const store = new FileIconStore(await mkdtemp(join(tmpdir(), 'launchpad-icon-')))
    const icon = await store.save('image/png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(icon.id).toMatch(/^[0-9a-f-]{36}$/i)
    expect((await store.get(icon.id))?.mimeType).toBe('image/png')
    await store.delete(icon.id)
    expect(await store.get(icon.id)).toBeUndefined()
  })

  it('rejects SVG, mismatched MIME, oversized payloads, and traversal', async () => {
    const store = new FileIconStore(await mkdtemp(join(tmpdir(), 'launchpad-icon-')))
    await expect(store.save('image/svg+xml', new Uint8Array([60, 115, 118, 103, 62]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(store.save('image/png', new Uint8Array([0, 1, 2]))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(store.save('image/png', new Uint8Array(512 * 1024 + 1))).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    await expect(store.get('../launchpad.db')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})
