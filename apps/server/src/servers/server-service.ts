import { randomUUID } from 'node:crypto'
import { serverInputSchema, type CredentialKind, type ServerInput, type ServerRecord } from '@ssh-launchpad/shared'
import type { AppRepository } from '../db/app-repository.js'
import type { ServerRepository } from '../db/server-repository.js'
import type { CredentialStore } from '../credentials/credential-store.js'
import { parseSshConfig, type SshConfigImportResult } from './ssh-config-parser.js'

export interface ServerService {
  list(): ServerRecord[]
  create(input: ServerInput, secret?: { kind: CredentialKind; value: string }): Promise<ServerRecord>
  update(id: string, input: ServerInput, secret?: { kind: CredentialKind; value: string }): Promise<ServerRecord>
  setCredential(id: string, secret: { kind: CredentialKind; value: string }): Promise<ServerRecord>
  deleteCredential(id: string): Promise<ServerRecord>
  remove(id: string): Promise<void>
  importConfig(text: string): SshConfigImportResult
}

function normalize(input: ServerInput): ServerInput {
  return serverInputSchema.parse(input) as ServerInput
}

function credentialParts(id: string): { serverId: string; kind: CredentialKind } {
  const separator = id.lastIndexOf(':')
  const kind = id.slice(separator + 1)
  if (separator <= 0 || (kind !== 'password' && kind !== 'private-key-passphrase')) {
    throw new Error('Invalid credential id')
  }
  return { serverId: id.slice(0, separator), kind }
}

export class DefaultServerService implements ServerService {
  constructor(
    private readonly servers: ServerRepository,
    private readonly apps: AppRepository,
    private readonly credentials: CredentialStore,
  ) {}

  list(): ServerRecord[] {
    return this.servers.list()
  }

  async create(input: ServerInput, secret?: { kind: CredentialKind; value: string }): Promise<ServerRecord> {
    const normalized = normalize(input)
    const id = randomUUID()
    let credentialId: string | undefined
    if (secret) credentialId = await this.credentials.set(id, secret.kind, secret.value)
    try {
      return this.servers.create(normalized, credentialId, id)
    } catch (error) {
      if (credentialId) await this.credentials.delete(credentialId).catch(() => undefined)
      throw error
    }
  }

  async update(id: string, input: ServerInput, secret?: { kind: CredentialKind; value: string }): Promise<ServerRecord> {
    const normalized = normalize(input)
    const existing = this.servers.get(id)
    if (!existing) return this.servers.update(id, normalized)

    const oldCredentialId = existing.credentialId
    let oldSecret: string | undefined
    if (oldCredentialId) oldSecret = await this.credentials.get(oldCredentialId)
    let newCredentialId = oldCredentialId
    if (secret) newCredentialId = await this.credentials.set(id, secret.kind, secret.value)
    try {
      const result = this.servers.update(id, normalized, newCredentialId)
      if (secret && oldCredentialId && oldCredentialId !== newCredentialId) await this.credentials.delete(oldCredentialId)
      return result
    } catch (error) {
      if (secret) {
        if (oldSecret !== undefined && oldCredentialId) {
          const old = credentialParts(oldCredentialId)
          await this.credentials.set(old.serverId, old.kind, oldSecret).catch(() => undefined)
        } else if (newCredentialId && newCredentialId !== oldCredentialId) {
          await this.credentials.delete(newCredentialId).catch(() => undefined)
        }
      }
      throw error
    }
  }

  async setCredential(id: string, secret: { kind: CredentialKind; value: string }): Promise<ServerRecord> {
    const existing = this.servers.get(id)
    if (!existing) return this.servers.update(id, existing as never)
    const oldCredentialId = existing.credentialId
    const oldSecret = oldCredentialId ? await this.credentials.get(oldCredentialId) : undefined
    const newCredentialId = await this.credentials.set(id, secret.kind, secret.value)
    try {
      const updated = this.servers.update(id, existing, newCredentialId)
      if (oldCredentialId && oldCredentialId !== newCredentialId) await this.credentials.delete(oldCredentialId)
      return updated
    } catch (error) {
      if (oldSecret !== undefined && oldCredentialId) {
        const old = credentialParts(oldCredentialId)
        await this.credentials.set(old.serverId, old.kind, oldSecret).catch(() => undefined)
      } else {
        await this.credentials.delete(newCredentialId).catch(() => undefined)
      }
      throw error
    }
  }

  async deleteCredential(id: string): Promise<ServerRecord> {
    const existing = this.servers.get(id)
    if (!existing) return this.servers.update(id, existing as never)
    if (!existing.credentialId) return existing
    const credentialId = existing.credentialId
    const old = credentialParts(credentialId)
    const secret = await this.credentials.get(credentialId)
    await this.credentials.delete(credentialId)
    try {
      return this.servers.update(id, existing, null)
    } catch (error) {
      await this.credentials.set(old.serverId, old.kind, secret).catch(() => undefined)
      throw error
    }
  }

  async remove(id: string): Promise<void> {
    const existing = this.servers.get(id)
    if (!existing) {
      this.servers.delete(id)
      return
    }
    if (this.apps.list(id).length > 0) {
      this.servers.delete(id) // repository supplies the stable RESOURCE_BUSY error
      return
    }
    let secret: string | undefined
    let credentialPartsValue: { serverId: string; kind: CredentialKind } | undefined
    if (existing.credentialId) {
      credentialPartsValue = credentialParts(existing.credentialId)
      secret = await this.credentials.get(existing.credentialId)
      await this.credentials.delete(existing.credentialId)
    }
    try {
      this.servers.delete(id)
    } catch (error) {
      if (secret !== undefined && credentialPartsValue) {
        await this.credentials.set(credentialPartsValue.serverId, credentialPartsValue.kind, secret).catch(() => undefined)
      }
      throw error
    }
  }

  importConfig(text: string): SshConfigImportResult {
    return parseSshConfig(text)
  }
}
