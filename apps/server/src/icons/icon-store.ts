import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { LaunchpadError } from '@ssh-launchpad/shared'

export interface StoredIcon {
  id: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  path: string
}

export interface IconStore {
  save(mimeType: string, bytes: Uint8Array): Promise<StoredIcon>
  get(id: string): Promise<StoredIcon | undefined>
  delete(id: string): Promise<void>
}

const MAX_SIZE = 512 * 1024
const formats = {
  'image/png': { extension: 'png', matches: (bytes: Uint8Array) => bytes.length >= 8 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]) },
  'image/jpeg': { extension: 'jpg', matches: (bytes: Uint8Array) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  'image/webp': { extension: 'webp', matches: (bytes: Uint8Array) => bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP' },
} as const

type SupportedMime = keyof typeof formats

function invalid(message: string): LaunchpadError {
  return new LaunchpadError('VALIDATION_FAILED', message)
}

export class FileIconStore implements IconStore {
  private readonly root: string

  constructor(root = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ssh-launchpad', 'icons')) {
    this.root = resolve(root)
  }

  async save(mimeType: string, bytes: Uint8Array): Promise<StoredIcon> {
    if (!(mimeType in formats)) throw invalid('Only PNG, JPEG, and WebP icons are supported')
    if (bytes.byteLength > MAX_SIZE) throw invalid('Icon is larger than 512 KiB')
    const format = formats[mimeType as SupportedMime]
    if (!format.matches(bytes)) throw invalid('Icon bytes do not match their MIME type')
    await mkdir(this.root, { recursive: true })
    const id = randomUUID()
    const path = join(this.root, `${id}.${format.extension}`)
    await writeFile(path, bytes, { flag: 'wx' })
    return { id, mimeType: mimeType as SupportedMime, path }
  }

  async get(id: string): Promise<StoredIcon | undefined> {
    const path = this.safePath(id)
    try {
      const files = await Promise.all(Object.values(formats).map(async (format) => {
        const candidate = `${path}.${format.extension}`
        try { await readFile(candidate); return { candidate, format } } catch { return undefined }
      }))
      const found = files.find((value) => value !== undefined)
      return found ? { id, mimeType: Object.entries(formats).find(([, value]) => value === found.format)![0] as SupportedMime, path: found.candidate } : undefined
    } catch (error) {
      if (error instanceof LaunchpadError) throw error
      throw error
    }
  }

  async delete(id: string): Promise<void> {
    const path = this.safePath(id)
    await Promise.all(Object.values(formats).map((format) => unlink(`${path}.${format.extension}`).catch(() => undefined)))
  }

  private safePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw invalid('Invalid icon id')
    const path = resolve(join(this.root, id))
    const relativePath = relative(this.root, path)
    if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) throw invalid('Invalid icon path')
    return path
  }
}
