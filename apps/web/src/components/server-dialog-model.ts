import type { ServerInput, ServerRecord } from '@ssh-launchpad/shared'

export const emptyServerInput: ServerInput = { name: '', source: 'manual', host: '', port: 22, username: '', authType: 'password', notes: '' }

export function serverInputFromRecord(record?: ServerRecord): ServerInput {
  if (!record) return { ...emptyServerInput }
  return { name: record.name, source: record.source, ...(record.configAlias ? { configAlias: record.configAlias } : {}), host: record.host, port: record.port, username: record.username, authType: record.authType, ...(record.privateKeyPath ? { privateKeyPath: record.privateKeyPath } : {}), notes: record.notes }
}
