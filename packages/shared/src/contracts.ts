import type { ErrorCode } from './errors.js'

export type ServerSource = 'manual' | 'ssh-config'
export type AuthType = 'password' | 'private-key' | 'ssh-config'
export type AppType = 'dsh' | 'openclaw' | 'custom'
export type Protocol = 'http' | 'https'
export type IconKind = 'preset' | 'url' | 'upload' | 'letter'
export type CredentialKind = 'password' | 'private-key-passphrase'

export interface ServerInput {
  name: string
  source: ServerSource
  configAlias?: string
  host: string
  port: number
  username: string
  authType: AuthType
  privateKeyPath?: string
  notes: string
}

export interface ServerRecord extends ServerInput {
  id: string
  credentialId?: string
  hostFingerprint?: string
  createdAt: string
  updatedAt: string
}

export interface RemoteAppInput {
  serverId: string
  name: string
  type: AppType
  remoteHost: string
  remotePort: number
  localPort: number
  protocol: Protocol
  healthPath: string
  autoStart: boolean
  workingDirectory?: string
  startCommand?: string
  stopOnDisconnect: boolean
  stopCommand?: string
  iconKind: IconKind
  iconValue: string
  startTimeoutMs: number
  healthTimeoutMs: number
}

export interface RemoteAppRecord extends RemoteAppInput {
  id: string
  createdAt: string
  updatedAt: string
}

export type RuntimeStatus =
  | 'disconnected'
  | 'checking'
  | 'connecting'
  | 'starting'
  | 'tunneling'
  | 'healthy'
  | 'conflict'
  | 'error'

export interface RuntimeSnapshot {
  appId: string
  status: RuntimeStatus
  errorCode?: ErrorCode
  errorMessage?: string
  startedByLaunchpad: boolean
  updatedAt: string
}

export type RuntimeEvent =
  | { type: 'snapshot'; snapshots: RuntimeSnapshot[] }
  | { type: 'runtime'; snapshot: RuntimeSnapshot }
  | { type: 'log'; appId: string; line: string; createdAt: string }

export interface ServerTestResult {
  ok: boolean
  candidateFingerprint?: string
}

export interface IconUploadResponse {
  id: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
}

export interface BootstrapResponse {
  servers: ServerRecord[]
  apps: RemoteAppRecord[]
  runtime: RuntimeSnapshot[]
}
