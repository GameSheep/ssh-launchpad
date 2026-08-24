import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { LogStore } from './types.js'

const MAX_BYTES = 1024 * 1024
const ARCHIVES = 4
const MAX_MEMORY_LINES = 200
const SENSITIVE_KEYS = /("?(?:password|passphrase|secret|privateKey|credential)"?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^,\s}\]]+)/gi

export class FileLogStore implements LogStore {
  private readonly memory = new Map<string, string[]>()
  private readonly secrets = new Set<string>()

  constructor(private readonly root = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'ssh-launchpad', 'logs')) {}

  registerSecret(secret: string): void {
    if (secret) this.secrets.add(secret)
  }

  async append(appId: string, line: string): Promise<void> {
    const safe = this.redact(line)
    const lines = this.memory.get(appId) ?? []
    lines.push(safe)
    while (lines.length > MAX_MEMORY_LINES) lines.shift()
    this.memory.set(appId, lines)
    const directory = join(this.root, appId)
    const current = join(directory, 'current.log')
    await mkdir(directory, { recursive: true })
    const bytes = Buffer.byteLength(`${safe}\n`, 'utf8')
    let size = 0
    try { size = (await stat(current)).size } catch { /* first write */ }
    if (size + bytes > MAX_BYTES) await this.rotate(directory, current)
    await appendFile(current, `${safe}\n`, 'utf8')
  }

  async read(appId: string, limit: number): Promise<string[]> {
    const cached = this.memory.get(appId)
    if (cached) return cached.slice(Math.max(0, cached.length - limit))
    const current = join(this.root, appId, 'current.log')
    try {
      const lines = (await readFile(current, 'utf8')).split(/\r?\n/).filter(Boolean)
      return lines.slice(Math.max(0, lines.length - limit))
    } catch { return [] }
  }

  private redact(line: string): string {
    let result = line.replace(SENSITIVE_KEYS, '$1[REDACTED]')
    for (const secret of this.secrets) result = result.replaceAll(secret, '[REDACTED]')
    return result
  }

  private async rotate(directory: string, current: string): Promise<void> {
    await unlink(join(directory, `archive-${ARCHIVES}.log`)).catch(() => undefined)
    for (let index = ARCHIVES - 1; index >= 1; index -= 1) {
      const from = join(directory, `archive-${index}.log`)
      const to = join(directory, `archive-${index + 1}.log`)
      await rename(from, to).catch(() => undefined)
    }
    await rename(current, join(directory, 'archive-1.log')).catch(() => undefined)
  }
}

export { FileLogStore as DiskLogStore }
