export interface ImportedSshHost {
  alias: string
  host: string
  port: number
  username: string
  identityFile?: string
}

export interface SshConfigImportResult { hosts: ImportedSshHost[]; warnings: string[] }

type HostBlock = { aliases: string[]; values: Map<string, string>; line: number }

function stripComment(line: string): string {
  let quote: '"' | "'" | undefined; let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (escaped) { escaped = false; continue }
    if (character === '\\' && quote !== "'") { escaped = true; continue }
    if (character === '"' || character === "'") { quote = quote === character ? undefined : quote ?? character; continue }
    if (character === '#' && !quote) return line.slice(0, index)
  }
  return line
}

function tokens(line: string): string[] {
  const output: string[] = []; const matcher = /("(?:\\.|[^"\\])*"|'(?:[^']*)'|\S+)/g
  for (const match of line.matchAll(matcher)) {
    const value = match[0]; if (!value) continue
    output.push((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")) ? value.slice(1, -1).replace(/\\([\\"'])/g, '$1') : value)
  }
  return output
}

export function parseSshConfig(text: string): SshConfigImportResult {
  const warnings: string[] = []; const blocks: HostBlock[] = []; let current: HostBlock | undefined
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const lineNumber = index + 1; const line = stripComment(rawLine).trim(); if (!line) continue
    const parts = tokens(line); const directive = parts.shift()?.toLowerCase(); if (!directive) continue
    if (directive === 'host') { if (!parts.length) { warnings.push(`第 ${lineNumber} 行：Host 缺少别名`); current = undefined; continue }; current = { aliases: parts, values: new Map(), line: lineNumber }; blocks.push(current); continue }
    if (directive === 'include' || directive === 'proxyjump') { warnings.push(`第 ${lineNumber} 行：${directive} 暂不支持，已忽略`); continue }
    if (!current) { warnings.push(`第 ${lineNumber} 行：${directive} 不在 Host 配置块中，已忽略`); continue }
    if (!['hostname', 'port', 'user', 'identityfile'].includes(directive)) { warnings.push(`第 ${lineNumber} 行：${directive} 暂不支持，已忽略`); continue }
    if (!parts.length) { warnings.push(`第 ${lineNumber} 行：${directive} 缺少值`); continue }
    if (!current.values.has(directive)) current.values.set(directive, parts.join(' '))
  }
  const hosts: ImportedSshHost[] = []
  for (const block of blocks) {
    if (block.aliases.some((alias) => /[*?!]/.test(alias))) { warnings.push(`第 ${block.line} 行：通配 Host 无法导入`); continue }
    const host = block.values.get('hostname'); const port = Number(block.values.get('port') ?? 22)
    if (!Number.isInteger(port) || port < 1 || port > 65535) { warnings.push(`第 ${block.line} 行：SSH 端口无效，已忽略`); continue }
    for (const alias of block.aliases) {
      const item: ImportedSshHost = { alias, host: host || alias, port, username: block.values.get('user') ?? '' }
      const identityFile = block.values.get('identityfile'); if (identityFile) item.identityFile = identityFile
      hosts.push(item)
    }
  }
  return { hosts, warnings }
}

