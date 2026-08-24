import { homedir } from 'node:os'

export interface ImportedSshHost {
  alias: string
  host: string
  port: number
  username: string
  identityFile?: string
}

export interface SshConfigImportResult {
  hosts: ImportedSshHost[]
  warnings: string[]
}

type HostBlock = {
  aliases: string[]
  values: Map<string, string>
  line: number
}

function stripComment(line: string): string {
  let quote: '"' | "'" | undefined
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (character === '"' || character === "'") {
      quote = quote === character ? undefined : quote ?? character
      continue
    }
    if (character === '#' && !quote) return line.slice(0, index)
  }
  return line
}

function tokens(line: string): string[] {
  const output: string[] = []
  const matcher = /("(?:\\.|[^"\\])*"|'(?:[^']*)'|\S+)/g
  for (const match of line.matchAll(matcher)) {
    const value = match[0]
    if (!value) continue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      output.push(value.slice(1, -1).replace(/\\([\\"'])/g, '$1'))
    } else {
      output.push(value)
    }
  }
  return output
}

function expandIdentityFile(value: string): string {
  const userProfile = process.env.USERPROFILE ?? homedir()
  return value
    .replace(/^~(?=$|[\\/])/, userProfile)
    .replace(/%USERPROFILE%/gi, userProfile)
}

function unsupportedWarning(directive: string, line: number): string {
  return `Line ${line}: ${directive} is not supported and was ignored`
}

export function parseSshConfig(text: string): SshConfigImportResult {
  const warnings: string[] = []
  const blocks: HostBlock[] = []
  let current: HostBlock | undefined

  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const parts = tokens(line)
    const directive = parts.shift()?.toLowerCase()
    if (!directive) continue

    if (directive === 'host') {
      if (parts.length === 0) {
        warnings.push(`Line ${lineNumber}: Host requires an alias`)
        current = undefined
        continue
      }
      current = { aliases: parts, values: new Map(), line: lineNumber }
      blocks.push(current)
      continue
    }

    if (directive === 'include' || directive === 'proxyjump') {
      warnings.push(unsupportedWarning(directive, lineNumber))
      continue
    }
    if (!current) {
      warnings.push(`Line ${lineNumber}: ${directive} is outside a Host block and was ignored`)
      continue
    }
    if (!['hostname', 'port', 'user', 'identityfile'].includes(directive)) {
      warnings.push(unsupportedWarning(directive, lineNumber))
      continue
    }
    if (parts.length === 0) {
      warnings.push(`Line ${lineNumber}: ${directive} requires a value`)
      continue
    }
    // SSH config uses first-value-wins semantics for these fields.
    if (!current.values.has(directive)) current.values.set(directive, parts.join(' '))
  }

  const hosts: ImportedSshHost[] = []
  for (const block of blocks) {
    const wildcard = block.aliases.some((alias) => /[*?!]/.test(alias))
    if (wildcard) {
      warnings.push(`Line ${block.line}: wildcard Host blocks cannot be imported`)
      continue
    }
    const host = block.values.get('hostname')
    const portValue = block.values.get('port')
    const port = portValue ? Number(portValue) : 22
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      warnings.push(`Line ${block.line}: invalid SSH port; block was ignored`)
      continue
    }
    const identity = block.values.get('identityfile')
    for (const alias of block.aliases) {
      const item: ImportedSshHost = {
        alias,
        host: host || alias,
        port,
        username: block.values.get('user') ?? '',
      }
      if (identity) item.identityFile = expandIdentityFile(identity)
      hosts.push(item)
    }
  }
  return { hosts, warnings }
}
