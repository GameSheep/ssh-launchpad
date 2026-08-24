# SSH Launchpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-local Web application that stores SSH server/application configurations and opens remote Web UIs through secure, one-click SSH tunnels.

**Architecture:** A React navigation homepage talks to a Fastify service bound only to `127.0.0.1`. The service persists non-secret configuration in SQLite, stores secrets in Windows Credential Manager, pools SSH sessions, owns local TCP listeners, orchestrates optional remote startup, and pushes runtime state through Server-Sent Events.

**Tech Stack:** Node.js 24.14+, TypeScript, React, Vite, Fastify, Server-Sent Events, `ssh2`, `node:sqlite`, `@napi-rs/keyring`, Zod, Vitest, Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-08-24-ssh-launchpad-design.md`

## Global Constraints

- The HTTP service and every application tunnel must bind only to `127.0.0.1`.
- Node.js 24.14 LTS or newer is required.
- Passwords and private-key passphrases must never enter SQLite, HTTP responses, or logs.
- Secrets must use Windows Credential Manager through `@napi-rs/keyring`; failure is closed, with no plaintext fallback.
- Local application ports are fixed, globally unique in configuration, and checked again by an actual bind before SSH work begins.
- Unknown SSH host keys require explicit confirmation; changed host keys always block connection.
- The first release imports only `Host`, `HostName`, `Port`, `User`, and the first `IdentityFile`; `ProxyJump`, wildcard composition, and recursive `Include` are rejected with an explanatory warning.
- Automatic remote start/stop targets Linux/POSIX shells; tunneling itself remains SSH-platform-neutral.
- Disconnecting closes local tunnels but does not stop a remote process unless all three stop conditions from the spec are true.
- The UI must retain the approved navigation-page layout: background, clock/date, search, server tabs, status widgets, application icon grid, and dark configuration dialogs.
- Each task uses test-first development and ends with a focused commit.

## Scope Check

This stays as one implementation plan because the browser UI, local API, credential store, SSH session, and tunnel are sequential parts of one independently testable user flow. None of them provides the requested outcome alone. The task boundaries below still expose explicit interfaces so reviewers can accept or reject each unit independently.

## File Structure

```text
.
├─ package.json                         npm workspace scripts and engine floor
├─ package-lock.json                    reproducible dependency resolution
├─ tsconfig.base.json                   shared strict TypeScript options
├─ eslint.config.js                     root lint rules
├─ vitest.workspace.ts                  unit/integration test projects
├─ playwright.config.ts                 browser end-to-end configuration
├─ apps/
│  ├─ server/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  └─ src/
│  │     ├─ main.ts                     production startup and shutdown
│  │     ├─ app.ts                      Fastify composition root
│  │     ├─ config.ts                   local paths, host, and control port
│  │     ├─ db/
│  │     │  ├─ database.ts              SQLite lifecycle and migrations
│  │     │  ├─ server-repository.ts     Server persistence
│  │     │  └─ app-repository.ts        RemoteApp persistence
│  │     ├─ credentials/
│  │     │  ├─ credential-store.ts      secret-store port
│  │     │  └─ keyring-store.ts         Windows Credential Manager adapter
│  │     ├─ servers/
│  │     │  ├─ ssh-config-parser.ts     supported SSH Config subset
│  │     │  └─ server-service.ts        server CRUD/import/test orchestration
│  │     ├─ ssh/
│  │     │  ├─ fingerprint.ts           OpenSSH SHA-256 fingerprints
│  │     │  ├─ posix-command.ts         safe detached command wrapper
│  │     │  ├─ ssh-session.ts           one SSH connection abstraction
│  │     │  └─ session-pool.ts           per-server sharing and reconnect
│  │     ├─ tunnels/
│  │     │  ├─ port-check.ts            local bind conflict details
│  │     │  └─ tunnel-manager.ts        listener and TCP forwarding lifecycle
│  │     ├─ runtime/
│  │     │  ├─ event-bus.ts             status/log subscriptions
│  │     │  ├─ log-store.ts             redacted 5 × 1 MiB disk rotation
│  │     │  ├─ health-checker.ts        bounded HTTP(S) checks
│  │     │  └─ app-runtime-service.ts   connect/start/tunnel/open orchestration
│  │     ├─ icons/
│  │     │  └─ icon-store.ts             validated uploaded icon files
│  │     ├─ api/
│  │     │  ├─ security.ts              Host, Origin, cookie, JSON checks
│  │     │  ├─ routes.ts                REST resources and commands
│  │     │  └─ events-route.ts          SSE endpoint
│  │     └─ test/
│  │        ├─ fakes.ts                 deterministic service doubles
│  │        └─ ssh-test-server.ts       in-process SSH fixture
│  └─ web/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ vite.config.ts
│     ├─ index.html
│     └─ src/
│        ├─ main.tsx                    React bootstrap
│        ├─ app.tsx                     page composition
│        ├─ styles.css                  approved responsive visual system
│        ├─ api/client.ts               typed REST client
│        ├─ api/events.ts               EventSource adapter
│        ├─ state/launchpad-store.tsx   bootstrap/runtime state reducer
│        ├─ components/
│        │  ├─ clock.tsx
│        │  ├─ search-bar.tsx
│        │  ├─ server-tabs.tsx
│        │  ├─ status-widgets.tsx
│        │  ├─ app-grid.tsx
│        │  ├─ app-tile.tsx
│        │  ├─ server-dialog.tsx
│        │  ├─ app-dialog.tsx
│        │  ├─ host-key-dialog.tsx
│        │  └─ app-details-dialog.tsx
│        └─ test/setup.ts
├─ packages/
│  └─ shared/
│     ├─ package.json
│     ├─ tsconfig.json
│     └─ src/
│        ├─ contracts.ts                records, inputs, API responses, events
│        ├─ schemas.ts                  Zod validation
│        ├─ errors.ts                   stable error codes
│        └─ index.ts                    public exports
├─ tests/e2e/
│  ├─ launchpad.spec.ts                 primary browser workflow
│  └─ fixtures.ts                       test server/HTTP service lifecycle
├─ scripts/
│  └─ verify-windows-credential.ts      real keyring smoke verification
└─ README.md                            install, run, security, and usage
```

---

### Task 1: Workspace and Shared Contracts

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `vitest.workspace.ts`
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/contracts.ts`
- Create: `packages/shared/src/schemas.ts`
- Create: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/schemas.test.ts`

**Interfaces:**
- Consumes: The approved field names and error codes in the design spec.
- Produces: `ServerRecord`, `RemoteAppRecord`, `RuntimeStatus`, `RuntimeEvent`, `ServerInput`, `RemoteAppInput`, `BootstrapResponse`, `ServerTestResult`, `IconUploadResponse`, `ApiErrorBody`, `serverInputSchema`, `remoteAppInputSchema`, and `LaunchpadError` exported by `@ssh-launchpad/shared`.

- [ ] **Step 1: Create the npm workspace and install the common toolchain**

Create the root manifest with workspaces `apps/server`, `apps/web`, and `packages/shared`; set `engines.node` to `>=24.14.0`; add root scripts `build`, `test`, `test:unit`, `test:e2e`, `lint`, `typecheck`, `dev`, and `start`. Name the workspaces `@ssh-launchpad/server`, `@ssh-launchpad/web`, and `@ssh-launchpad/shared`; server and web declare `"@ssh-launchpad/shared": "*"`. Then run:

```powershell
npm install -D typescript tsx @types/node vitest @vitest/coverage-v8 concurrently eslint @eslint/js typescript-eslint
npm install zod -w @ssh-launchpad/shared
```

Commit the resulting `package-lock.json`; do not hand-edit dependency versions after npm resolves them.

- [ ] **Step 2: Add strict TypeScript project configuration**

Use `module: "NodeNext"`, `moduleResolution: "NodeNext"`, `target: "ES2023"`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `verbatimModuleSyntax: true`, and `skipLibCheck: true` in `tsconfig.base.json`. Each workspace extends it and emits into its own `dist` directory.

- [ ] **Step 3: Write failing shared-schema tests**

```ts
import { describe, expect, it } from 'vitest'
import { remoteAppInputSchema, serverInputSchema } from './schemas.js'

describe('serverInputSchema', () => {
  it('rejects a password server without username', () => {
    const result = serverInputSchema.safeParse({
      name: 'GPU', source: 'manual', host: '10.0.0.2', port: 22,
      username: '', authType: 'password', notes: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('remoteAppInputSchema', () => {
  it('requires a start command when autoStart is enabled', () => {
    const result = remoteAppInputSchema.safeParse({
      serverId: crypto.randomUUID(), name: 'DSH', type: 'dsh',
      remoteHost: '127.0.0.1', remotePort: 3080, localPort: 13080,
      protocol: 'http', healthPath: '/', autoStart: true,
      workingDirectory: '', startCommand: '', stopOnDisconnect: false,
      stopCommand: '', iconKind: 'letter', iconValue: 'DS',
      startTimeoutMs: 30_000, healthTimeoutMs: 10_000,
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 4: Run the shared tests and confirm the red state**

Run: `npm run test:unit -- packages/shared/src/schemas.test.ts`

Expected: FAIL because `schemas.ts` and its exports do not exist.

- [ ] **Step 5: Implement shared records, schemas, events, and errors**

Define literal unions rather than free-form strings. The error union must contain exactly:

```ts
export type ErrorCode =
  | 'VALIDATION_FAILED' | 'LOCAL_PORT_IN_USE' | 'SSH_AUTH_FAILED'
  | 'SSH_HOST_KEY_UNKNOWN' | 'SSH_HOST_KEY_CHANGED'
  | 'SSH_CONNECTION_FAILED' | 'REMOTE_PORT_CLOSED'
  | 'REMOTE_START_FAILED' | 'REMOTE_START_TIMEOUT' | 'TUNNEL_FAILED'
  | 'HEALTH_CHECK_FAILED' | 'CREDENTIAL_UNAVAILABLE'
  | 'RESOURCE_BUSY' | 'NOT_FOUND' | 'FORBIDDEN' | 'INTERNAL_ERROR'
```

Use `z.coerce.number().int().min(1).max(65535)` for ports, require `healthPath` to start with `/`, require `startCommand` when `autoStart=true`, and require `stopCommand` when `stopOnDisconnect=true`.

- [ ] **Step 6: Run shared tests and type checking**

Run: `npm run test:unit -- packages/shared/src/schemas.test.ts && npm run typecheck`

Expected: both commands PASS.

- [ ] **Step 7: Commit the workspace foundation**

```powershell
git add package.json package-lock.json tsconfig.base.json eslint.config.js vitest.workspace.ts apps packages
git commit -m "chore: initialize SSH Launchpad workspace"
```

---

### Task 2: SQLite Database and Repositories

**Files:**
- Create: `apps/server/src/db/database.ts`
- Create: `apps/server/src/db/server-repository.ts`
- Create: `apps/server/src/db/app-repository.ts`
- Test: `apps/server/src/db/repositories.test.ts`

**Interfaces:**
- Consumes: `ServerRecord`, `ServerInput`, `RemoteAppRecord`, and `RemoteAppInput` from `@ssh-launchpad/shared`.
- Produces: `openDatabase(path: string): LaunchpadDatabase`, `ServerRepository`, and `AppRepository`.

```ts
export interface ServerRepository {
  list(): ServerRecord[]
  get(id: string): ServerRecord | undefined
  create(input: ServerInput, credentialId?: string): ServerRecord
  update(id: string, input: ServerInput, credentialId?: string): ServerRecord
  setFingerprint(id: string, fingerprint: string): ServerRecord
  delete(id: string): void
}

export interface AppRepository {
  list(serverId?: string): RemoteAppRecord[]
  get(id: string): RemoteAppRecord | undefined
  create(input: RemoteAppInput): RemoteAppRecord
  update(id: string, input: RemoteAppInput): RemoteAppRecord
  delete(id: string): void
  findByLocalPort(port: number, excludeId?: string): RemoteAppRecord | undefined
}
```

- [ ] **Step 1: Write failing repository tests against `:memory:`**

Cover create/read/update/delete, cascading protection, timestamp changes, and global local-port uniqueness:

```ts
it('rejects duplicate local ports across different servers', () => {
  const first = apps.create(appInput({ serverId: serverA.id, localPort: 13080 }))
  expect(first.localPort).toBe(13080)
  expect(() => apps.create(appInput({ serverId: serverB.id, localPort: 13080 })))
    .toThrowError(expect.objectContaining({ code: 'LOCAL_PORT_IN_USE' }))
})
```

- [ ] **Step 2: Run the repository test and confirm failure**

Run: `npm run test:unit -- apps/server/src/db/repositories.test.ts`

Expected: FAIL because the database and repositories do not exist.

- [ ] **Step 3: Implement database lifecycle and migration 1**

Use `DatabaseSync` from `node:sqlite`, enable foreign keys, and migrate inside `BEGIN IMMEDIATE`/`COMMIT`. Create `servers` and `remote_apps` tables matching the spec, a foreign key from apps to servers with `ON DELETE RESTRICT`, and `UNIQUE(local_port)`.

Expose:

```ts
export interface LaunchpadDatabase {
  raw: DatabaseSync
  close(): void
}
```

Set `PRAGMA user_version = 1` only after all migration statements succeed; roll back on error.

- [ ] **Step 4: Implement repositories with prepared statements**

Map snake-case database columns to shared camel-case records in private mapper functions. Convert SQLite constraint errors to `LaunchpadError('LOCAL_PORT_IN_USE', ...)` or `LaunchpadError('RESOURCE_BUSY', ...)` instead of leaking SQLite messages.

- [ ] **Step 5: Run repository tests and type checking**

Run: `npm run test:unit -- apps/server/src/db/repositories.test.ts && npm run typecheck`

Expected: PASS with the in-memory database closed in `afterEach`.

- [ ] **Step 6: Commit database persistence**

```powershell
git add apps/server/src/db
git commit -m "feat: persist servers and remote applications"
```

---

### Task 3: Windows Credential Store

**Files:**
- Create: `apps/server/src/credentials/credential-store.ts`
- Create: `apps/server/src/credentials/keyring-store.ts`
- Test: `apps/server/src/credentials/keyring-store.test.ts`

**Interfaces:**
- Consumes: server UUID and secret kind.
- Produces: `CredentialStore`, `KeyringCredentialStore`, and `credentialAccount(serverId, kind)`.

```ts
export type CredentialKind = 'password' | 'private-key-passphrase'

export interface CredentialStore {
  set(serverId: string, kind: CredentialKind, secret: string): Promise<string>
  get(credentialId: string): Promise<string>
  delete(credentialId: string): Promise<void>
}
```

- [ ] **Step 1: Install the keyring binding**

Run: `npm install @napi-rs/keyring -w @ssh-launchpad/server`

The lockfile must contain the prebuilt Windows package selected by npm; no build toolchain may be required on the user machine.

- [ ] **Step 2: Write failing adapter tests with an injected entry factory**

```ts
it('uses a UUID-based account and never embeds the secret in the id', async () => {
  const entry = fakeEntry()
  const store = new KeyringCredentialStore(() => entry)
  const id = await store.set(serverId, 'password', 's3cret')
  expect(id).toBe(`${serverId}:password`)
  expect(entry.setPassword).toHaveBeenCalledWith('s3cret')
  expect(id).not.toContain('s3cret')
})

it('fails closed when the native keyring is unavailable', async () => {
  const store = new KeyringCredentialStore(() => { throw new Error('native unavailable') })
  await expect(store.set(serverId, 'password', 's3cret'))
    .rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' })
})
```

- [ ] **Step 3: Run tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/credentials/keyring-store.test.ts`

Expected: FAIL because the credential interfaces do not exist.

- [ ] **Step 4: Implement the keyring adapter**

Use service name `ssh-launchpad` and account `${serverId}:${kind}`. Wrap `Entry.setPassword`, `getPassword`, and `deletePassword`. Convert missing entries and native errors to `CREDENTIAL_UNAVAILABLE`; never include the original secret or native object in error details.

- [ ] **Step 5: Run credential tests**

Run: `npm run test:unit -- apps/server/src/credentials/keyring-store.test.ts`

Expected: PASS, including get/delete and missing-entry cases.

- [ ] **Step 6: Commit the credential boundary**

```powershell
git add package-lock.json apps/server/package.json apps/server/src/credentials
git commit -m "feat: store SSH secrets in Windows Credential Manager"
```

---

### Task 4: SSH Config Import and Server Service

**Files:**
- Create: `apps/server/src/servers/ssh-config-parser.ts`
- Create: `apps/server/src/servers/server-service.ts`
- Test: `apps/server/src/servers/ssh-config-parser.test.ts`
- Test: `apps/server/src/servers/server-service.test.ts`

**Interfaces:**
- Consumes: `ServerRepository`, `AppRepository`, `CredentialStore`, `ServerInput`.
- Produces: `parseSshConfig(text: string): SshConfigImportResult` and `ServerService`.

```ts
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

export interface ServerService {
  list(): ServerRecord[]
  create(input: ServerInput, secret?: { kind: CredentialKind; value: string }): Promise<ServerRecord>
  update(id: string, input: ServerInput, secret?: { kind: CredentialKind; value: string }): Promise<ServerRecord>
  setCredential(id: string, secret: { kind: CredentialKind; value: string }): Promise<ServerRecord>
  deleteCredential(id: string): Promise<ServerRecord>
  remove(id: string): Promise<void>
  importConfig(text: string): SshConfigImportResult
}
```

- [ ] **Step 1: Write parser tests for the supported subset**

Use a fixture containing comments, blank lines, quoted identity paths, multiple aliases, `ProxyJump`, wildcard `Host *`, and `Include`. Assert that concrete single aliases import supported fields and unsupported directives produce warnings rather than silently changing behavior.

- [ ] **Step 2: Run parser tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/servers/ssh-config-parser.test.ts`

Expected: FAIL because `parseSshConfig` does not exist.

- [ ] **Step 3: Implement the supported parser**

Tokenize one logical line at a time, strip comments outside quotes, normalize directive names case-insensitively, expand `%USERPROFILE%` and `~` in `IdentityFile`, and reject wildcard aliases. Preserve file order and use the first `IdentityFile` per host.

- [ ] **Step 4: Write failing ServerService tests**

Assert that secrets are written before the server stores their credential ID, update replaces the keyring value without returning it, `setCredential` and `deleteCredential` preserve the server record, remove deletes the credential, and a failed database update restores the previous keyring value.

- [ ] **Step 5: Run ServerService tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/servers/server-service.test.ts`

Expected: FAIL because `ServerService` is not implemented.

- [ ] **Step 6: Implement ServerService transaction ordering**

Validate with shared Zod schemas. When creating with a secret, write keyring first, persist the returned ID second, and remove the new keyring entry if database creation fails. For an update, read the old secret before replacing it and restore it if database persistence fails. On deletion, check that no apps reference the server before deleting the keyring entry; if the final database delete fails, restore the captured secret before returning the error.

- [ ] **Step 7: Run server tests and commit**

Run: `npm run test:unit -- apps/server/src/servers && npm run typecheck`

```powershell
git add apps/server/src/servers
git commit -m "feat: manage servers and import SSH config"
```

---

### Task 5: SSH Session, Fingerprints, and POSIX Commands

**Files:**
- Create: `apps/server/src/ssh/fingerprint.ts`
- Create: `apps/server/src/ssh/posix-command.ts`
- Create: `apps/server/src/ssh/ssh-session.ts`
- Create: `apps/server/src/ssh/session-pool.ts`
- Create: `apps/server/src/ssh/server-connection-service.ts`
- Create: `apps/server/src/test/ssh-test-server.ts`
- Test: `apps/server/src/ssh/fingerprint.test.ts`
- Test: `apps/server/src/ssh/posix-command.test.ts`
- Test: `apps/server/src/ssh/ssh-session.integration.test.ts`
- Test: `apps/server/src/ssh/session-pool.test.ts`
- Test: `apps/server/src/ssh/server-connection-service.test.ts`

**Interfaces:**
- Consumes: `ServerRecord`, `CredentialStore`, Node `Duplex` streams.
- Produces: `SshSession`, `SshSessionFactory`, `SessionPool`, `SessionLease`, `ServerConnectionService`, `openSshFingerprint`, and `buildDetachedCommand`.

```ts
export interface ExecResult { stdout: string; stderr: string; exitCode: number | null }
export interface DetachedProcess { pid: number; logPath: string }

export interface SshSession {
  probe(remoteHost: string, remotePort: number): Promise<boolean>
  openForward(remoteHost: string, remotePort: number): Promise<NodeJS.ReadWriteStream>
  exec(command: string, timeoutMs: number): Promise<ExecResult>
  execDetached(input: { appId: string; workingDirectory?: string; command: string; timeoutMs: number }): Promise<DetachedProcess>
  onDisconnect(listener: (error?: Error) => void): () => void
  close(): Promise<void>
}

export interface SshSessionFactory {
  connect(server: ServerRecord, secret?: string): Promise<SshSession>
}

export interface SessionLease { session: SshSession; release(): Promise<void> }
export interface SessionPool { acquire(server: ServerRecord): Promise<SessionLease>; closeAll(): Promise<void> }

export interface ServerConnectionService {
  test(serverId: string): Promise<{ ok: true } | { ok: false; candidateFingerprint: string }>
  confirmFingerprint(serverId: string, candidateFingerprint: string): ServerRecord
}
```

- [ ] **Step 1: Install SSH dependencies**

Run: `npm install ssh2 -w @ssh-launchpad/server && npm install -D @types/ssh2 -w @ssh-launchpad/server`

- [ ] **Step 2: Write failing fingerprint and POSIX quoting tests**

Assert OpenSSH format `SHA256:<base64-without-padding>`. Test working directories containing spaces and single quotes. Assert the detached wrapper contains `nohup sh -lc`, redirects stdin, returns `$!`, and writes to `$HOME/.cache/ssh-launchpad/<appId>.log`.

- [ ] **Step 3: Run helper tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/ssh/fingerprint.test.ts apps/server/src/ssh/posix-command.test.ts`

Expected: FAIL because both helper modules are missing.

- [ ] **Step 4: Implement fingerprinting and command construction**

`openSshFingerprint(key)` must hash the raw host key with SHA-256 and remove Base64 `=` padding. `quotePosix(value)` must wrap with single quotes and replace each embedded quote with `'"'"'`. `buildDetachedCommand` must quote working directory, command payload, app ID, and log path independently.

- [ ] **Step 5: Create an in-process SSH test server and failing session tests**

The fixture must generate an ephemeral host key once per test file, support password and public-key authentication, handle `exec`, and forward TCP connections to a local echo/HTTP server. Test correct password, wrong password, unknown fingerprint, changed fingerprint, `probe`, `openForward`, command timeout, and detached PID parsing.

- [ ] **Step 6: Run the session integration test and confirm failure**

Run: `npm run test:unit -- apps/server/src/ssh/ssh-session.integration.test.ts`

Expected: FAIL because `Ssh2Session` does not exist.

- [ ] **Step 7: Implement `Ssh2Session`**

Configure `hostVerifier` on every connection; never use ssh2's default auto-accept behavior. Map authentication, host-key, timeout, and transport failures to stable `LaunchpadError` codes. Limit captured stdout and stderr to 64 KiB each. Destroy channels on timeout.

- [ ] **Step 8: Write and implement SessionPool tests**

Test one connection per server, reference-counted release, immediate removal on disconnect, and `closeAll`. SessionPool does not retry by itself; application-level reconnect remains owned by AppRuntimeService.

- [ ] **Step 9: Write and implement ServerConnectionService tests**

Inject repositories, credentials, and an SSH factory. On `SSH_HOST_KEY_UNKNOWN`, store the candidate fingerprint in a one-time in-memory map and return it to the caller. `confirmFingerprint` must match and consume that exact candidate before calling `ServerRepository.setFingerprint`; a fabricated, changed, or already-consumed value throws `FORBIDDEN`.

- [ ] **Step 10: Run all SSH tests and commit**

Run: `npm run test:unit -- apps/server/src/ssh apps/server/src/test/ssh-test-server.ts && npm run typecheck`

```powershell
git add package-lock.json apps/server/package.json apps/server/src/ssh apps/server/src/test/ssh-test-server.ts
git commit -m "feat: connect and share verified SSH sessions"
```

---

### Task 6: Local Port Reservation and Tunnel Manager

**Files:**
- Create: `apps/server/src/tunnels/port-check.ts`
- Create: `apps/server/src/tunnels/tunnel-manager.ts`
- Test: `apps/server/src/tunnels/tunnel-manager.test.ts`

**Interfaces:**
- Consumes: `SshSession.openForward`, app UUID, local port, remote host, and remote port.
- Produces: `TunnelManager`, `PortReservation`, and `TunnelHandle`.

```ts
export interface PortReservation {
  readonly appId: string
  readonly localPort: number
  activate(session: SshSession, remoteHost: string, remotePort: number): Promise<TunnelHandle>
  release(): Promise<void>
}

export interface TunnelHandle {
  readonly localPort: number
  close(): Promise<void>
}

export interface TunnelManager {
  reserve(appId: string, localPort: number): Promise<PortReservation>
  get(appId: string): TunnelHandle | undefined
  close(appId: string): Promise<void>
  closeAll(): Promise<void>
}
```

- [ ] **Step 1: Write failing conflict and forwarding tests**

Open a real local server on a chosen ephemeral port, then assert `reserve` throws `LOCAL_PORT_IN_USE` with the port in non-secret details. For forwarding, inject a fake `SshSession` whose `openForward` connects to a local echo server; assert bytes move in both directions.

- [ ] **Step 2: Run tunnel tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/tunnels/tunnel-manager.test.ts`

Expected: FAIL because `TunnelManager` does not exist.

- [ ] **Step 3: Implement reservation without a time-of-check/time-of-use gap**

`reserve` must immediately listen on `127.0.0.1`. Its connection callback closes sockets until `activate` supplies an SSH session. `activate` changes the callback's internal forwarding target without rebinding the port. Track client sockets and SSH streams so `close` awaits their destruction.

- [ ] **Step 4: Add idempotence and cleanup tests**

Assert duplicate reserve for one app returns `RESOURCE_BUSY`, two apps cannot reserve the same port, repeated close succeeds, and `closeAll` leaves every tested port bindable again.

- [ ] **Step 5: Run tunnel tests and commit**

Run: `npm run test:unit -- apps/server/src/tunnels/tunnel-manager.test.ts && npm run typecheck`

```powershell
git add apps/server/src/tunnels
git commit -m "feat: reserve local ports and forward SSH traffic"
```

---

### Task 7: Runtime Events, Health Checks, and Application Orchestration

**Files:**
- Create: `apps/server/src/runtime/event-bus.ts`
- Create: `apps/server/src/runtime/log-store.ts`
- Create: `apps/server/src/runtime/health-checker.ts`
- Create: `apps/server/src/runtime/app-runtime-service.ts`
- Create: `apps/server/src/test/fakes.ts`
- Test: `apps/server/src/runtime/event-bus.test.ts`
- Test: `apps/server/src/runtime/log-store.test.ts`
- Test: `apps/server/src/runtime/health-checker.test.ts`
- Test: `apps/server/src/runtime/app-runtime-service.test.ts`

**Interfaces:**
- Consumes: repositories, CredentialStore, SessionPool, TunnelManager, and `RuntimeEvent`.
- Produces: `RuntimeEventBus`, `LogStore`, `HealthChecker`, and `AppRuntimeService`.

```ts
export interface RuntimeEventBus {
  publish(event: RuntimeEvent): Promise<void>
  subscribe(listener: (event: RuntimeEvent) => void): () => void
  snapshot(): Record<string, RuntimeStatus>
}

export interface LogStore {
  append(appId: string, line: string): Promise<void>
  read(appId: string, limit: number): Promise<string[]>
}

export interface HealthChecker {
  check(url: string, timeoutMs: number): Promise<void>
}

export interface ConnectResult { url: string; status: 'healthy' }

export interface AppRuntimeService {
  connect(appId: string): Promise<ConnectResult>
  disconnect(appId: string): Promise<void>
  reconnect(appId: string): Promise<ConnectResult>
  getLogs(appId: string): Promise<string[]>
  shutdown(): Promise<void>
}
```

- [ ] **Step 1: Write failing EventBus, LogStore, and HealthChecker tests**

Assert subscribe/unsubscribe, last-status snapshots, log redaction, successful 2xx/3xx checks, timeout, connection refusal, and `HEALTH_CHECK_FAILED`. For `LogStore`, write enough fixed-size lines to cross six 1 MiB generations and assert only five files total remain (`current.log` plus four archives). Use a real local HTTP server; do not mock global `fetch` for the integration case.

- [ ] **Step 2: Run runtime utility tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/runtime/event-bus.test.ts apps/server/src/runtime/log-store.test.ts apps/server/src/runtime/health-checker.test.ts`

Expected: FAIL because the runtime utility modules are missing.

- [ ] **Step 3: Implement event, disk-log, and health utilities**

Keep at most 200 sanitized log lines per app in memory and write the same sanitized line to disk. Redact properties named `password`, `passphrase`, `secret`, `privateKey`, and `credential`, plus exact secret values registered for the current operation. Rotate at exactly 1 MiB and retain `current.log` plus four numbered archives per app. Health checks use `AbortSignal.timeout(timeoutMs)` and accept any response below 500 as reachable.

- [ ] **Step 4: Write failing orchestration tests**

Create deterministic fakes for repositories, session leases, reservations, and health checks. Cover this exact event order:

```ts
expect(statuses).toEqual([
  'checking', 'connecting', 'starting', 'tunneling', 'healthy',
])
```

Also cover: already-open remote port skips start; closed port with `autoStart=false` fails; start non-zero exit fails; start timeout releases the port/session; duplicate connect shares one promise; disconnect runs the explicit stop command only when all three conditions are true; health failure closes the tunnel; unexpected SSH disconnect retries at 1 s, 3 s, and 10 s and stops after the third failure. Use Vitest fake timers so no test sleeps.

- [ ] **Step 5: Run orchestration tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/runtime/app-runtime-service.test.ts`

Expected: FAIL because `AppRuntimeServiceImpl` is missing.

- [ ] **Step 6: Implement the connect state machine**

Reserve the local port first, acquire SSH second, probe third, optionally start and poll fourth, activate the tunnel fifth, and health-check last. Use a `Map<string, Promise<ConnectResult>>` for in-flight idempotence. Always release partial resources in reverse acquisition order.

- [ ] **Step 7: Implement disconnect and network-reconnect behavior**

Store whether this run started the remote process. On unexpected session disconnect, publish `connecting`, rebuild the lease/tunnel at 1 s, 3 s, and 10 s, then publish `error` after the third failure. Do not rerun `startCommand` if the remote port is already open after reconnect.

- [ ] **Step 8: Run runtime tests and commit**

Run: `npm run test:unit -- apps/server/src/runtime && npm run typecheck`

```powershell
git add apps/server/src/runtime apps/server/src/test/fakes.ts
git commit -m "feat: orchestrate remote applications and tunnel state"
```

---

### Task 8: Uploaded Icon Storage

**Files:**
- Create: `apps/server/src/icons/icon-store.ts`
- Test: `apps/server/src/icons/icon-store.test.ts`

**Interfaces:**
- Consumes: `%LOCALAPPDATA%\ssh-launchpad\icons`, a MIME type, and Base64-decoded bytes.
- Produces: `IconStore` and `StoredIcon`.

```ts
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
```

- [ ] **Step 1: Write failing icon validation tests**

Use small binary fixtures with valid PNG, JPEG, and WebP signatures. Assert save/get/delete, UUID filenames, 512 KiB maximum decoded size, rejection of MIME/signature mismatch, rejection of SVG, and path traversal rejection for `get('../launchpad.db')`.

- [ ] **Step 2: Run icon tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/icons/icon-store.test.ts`

Expected: FAIL because `FileIconStore` does not exist.

- [ ] **Step 3: Implement `FileIconStore`**

Generate the ID with `crypto.randomUUID()`, choose the extension from the verified magic bytes rather than the request, write with exclusive creation, and return only the generated ID plus safe MIME/path metadata. Resolve every read/delete path and verify it remains inside the configured icon directory.

- [ ] **Step 4: Run icon tests and commit**

Run: `npm run test:unit -- apps/server/src/icons/icon-store.test.ts && npm run typecheck`

```powershell
git add apps/server/src/icons
git commit -m "feat: validate and store application icons"
```

---

### Task 9: Secured Fastify API and Server-Sent Events

**Files:**
- Create: `apps/server/src/api/security.ts`
- Create: `apps/server/src/api/routes.ts`
- Create: `apps/server/src/api/events-route.ts`
- Create: `apps/server/src/app.ts`
- Test: `apps/server/src/api/security.test.ts`
- Test: `apps/server/src/api/routes.test.ts`
- Test: `apps/server/src/api/events-route.test.ts`

**Interfaces:**
- Consumes: `ServerService`, `AppRepository`, `AppRuntimeService`, `RuntimeEventBus`.
- Produces: `buildApp(dependencies: AppDependencies): Promise<FastifyInstance>`.

```ts
export interface AppDependencies {
  servers: ServerService
  serverConnections: ServerConnectionService
  apps: AppRepository
  runtime: AppRuntimeService
  events: RuntimeEventBus
  icons: IconStore
  sessionToken: string
  allowedPort: number
  webRoot?: string
}
```

- [ ] **Step 1: Install Fastify server dependencies**

Run:

```powershell
npm install fastify @fastify/cookie @fastify/static -w @ssh-launchpad/server
```

- [ ] **Step 2: Write failing local-security tests using `fastify.inject`**

Test allowed Hosts `127.0.0.1:<port>` and `localhost:<port>`, rejection of `evil.example`, rejection of a non-local Origin, rejection of mutation without the HttpOnly SameSite=Strict session cookie, rejection of non-JSON mutation, and acceptance of the bootstrap GET.

- [ ] **Step 3: Run security tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/api/security.test.ts`

Expected: FAIL because the security hooks do not exist.

- [ ] **Step 4: Implement security hooks and error serialization**

Register `onRequest` checks before routes. Set the session cookie only on the same-origin HTML/bootstrap flow. Serialize `LaunchpadError` as `{ error: { code, message, details } }`; serialize unknown errors as `INTERNAL_ERROR` in logs and a generic 500 body without stack traces.

- [ ] **Step 5: Write failing REST route tests**

Cover the exact endpoints from spec section 10. Assert Zod validation, CRUD results, 404, 409 for busy resources, secret non-echo, connect idempotence, disconnect, reconnect, log retrieval, unknown-fingerprint confirmation, and PNG/JPEG/WebP icon upload/read. Assert fingerprint confirmation rejects a value that was not produced by the server's most recent test attempt, and assert SVG/oversized icons return 400.

- [ ] **Step 6: Implement REST routes**

Keep route handlers thin: parse, call one service method, map status codes. `POST /api/servers` accepts `{ server, credential? }` so ServerService can persist configuration and secret atomically. The credential PUT/DELETE routes call `setCredential`/`deleteCredential` and return only the updated server record. `POST /api/servers/:id/confirm-fingerprint` consumes the one-time candidate stored by the preceding test request. `POST /api/icons` accepts `{ mimeType, dataBase64 }`, decodes once, and passes bytes to IconStore. For app creation/update, call `apps.findByLocalPort` before persistence to return the conflicting application name in safe details; when deleting an app with an uploaded icon, delete the icon after the database delete succeeds.

- [ ] **Step 7: Write and implement SSE tests**

Subscribe before sending headers, emit an initial `snapshot` event, format every later event as `event: runtime\ndata: <json>\n\n`, send a comment heartbeat every 15 seconds, and unsubscribe on request close. Test formatting with an injected fake reply stream and fake timers.

- [ ] **Step 8: Run API tests and commit**

Run: `npm run test:unit -- apps/server/src/api apps/server/src/app.ts && npm run typecheck`

```powershell
git add package-lock.json apps/server/package.json apps/server/src/api apps/server/src/app.ts
git commit -m "feat: expose a local secured launchpad API"
```

---

### Task 10: Navigation Homepage Shell

**Files:**
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app.tsx`
- Create: `apps/web/src/styles.css`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/state/launchpad-store.tsx`
- Create: `apps/web/src/components/clock.tsx`
- Create: `apps/web/src/components/search-bar.tsx`
- Create: `apps/web/src/components/server-tabs.tsx`
- Create: `apps/web/src/components/status-widgets.tsx`
- Create: `apps/web/src/components/app-grid.tsx`
- Create: `apps/web/src/components/app-tile.tsx`
- Create: `apps/web/src/test/setup.ts`
- Test: `apps/web/src/app.test.tsx`

**Interfaces:**
- Consumes: `GET /api/bootstrap`, `ServerRecord`, `RemoteAppRecord`, and runtime snapshot contracts.
- Produces: `LaunchpadProvider`, `useLaunchpad`, the responsive navigation homepage, and `ApiClient`.

```ts
export interface ApiClient {
  bootstrap(): Promise<BootstrapResponse>
  request<T>(path: string, init?: RequestInit): Promise<T>
}
```

- [ ] **Step 1: Install React test and build dependencies**

Run:

```powershell
npm install react react-dom -w @ssh-launchpad/web
npm install -D vite @vitejs/plugin-react @types/react @types/react-dom jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom -w @ssh-launchpad/web
```

- [ ] **Step 2: Write the failing homepage behavior test**

Render three servers and five apps through a fake client. Assert the clock/date, search box, “全部应用”, one tab per server, two status widgets, and all application names. Click a server tab and assert only its apps remain; type a port and assert only the matching app remains.

- [ ] **Step 3: Run the homepage test and confirm failure**

Run: `npm run test:unit -- apps/web/src/app.test.tsx`

Expected: FAIL because the React application does not exist.

- [ ] **Step 4: Implement state bootstrap and filtering**

Use React context plus `useReducer`; avoid an additional state library. Store normalized arrays and compute visible apps from `selectedServerId` and `query`. Search case-insensitively across app name, server name, and decimal local port.

- [ ] **Step 5: Implement the approved visual shell**

Translate the confirmed mockup into semantic components and one scoped stylesheet. Use a bundled CSS gradient background, centered clock/date, translucent search bar, centered server tabs, two compact status widgets, and an auto-fill icon grid. At widths below 640 px, switch dialogs/forms to one column and the icon grid to four columns; below 390 px use three columns.

- [ ] **Step 6: Run UI tests and inspect responsive builds**

Run: `npm run test:unit -- apps/web/src/app.test.tsx && npm run build -w @ssh-launchpad/web`

Expected: PASS with no overflow at 320 px in browser devtools.

- [ ] **Step 7: Commit the homepage**

```powershell
git add package-lock.json apps/web
git commit -m "feat: add the navigation-style launchpad homepage"
```

---

### Task 11: Server and Application Configuration Dialogs

**Files:**
- Create: `apps/web/src/components/server-dialog.tsx`
- Create: `apps/web/src/components/app-dialog.tsx`
- Create: `apps/web/src/components/host-key-dialog.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/state/launchpad-store.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/components/server-dialog.test.tsx`
- Test: `apps/web/src/components/app-dialog.test.tsx`

**Interfaces:**
- Consumes: server/app schemas, CRUD API, SSH Config import result, and host-key error details.
- Produces: controlled dialogs whose successful saves refresh the Launchpad store without ever retaining submitted secrets.

- [ ] **Step 1: Write failing ServerDialog tests**

Cover manual versus SSH Config mode, password/private-key fields, import preview, secret clearing after submit, first-use fingerprint confirmation, changed-fingerprint hard block, and visible API errors. Assert the edit dialog displays “凭据已保存” rather than the password.

- [ ] **Step 2: Run ServerDialog tests and confirm failure**

Run: `npm run test:unit -- apps/web/src/components/server-dialog.test.tsx`

Expected: FAIL because `ServerDialog` does not exist.

- [ ] **Step 3: Implement ServerDialog and HostKeyDialog**

Use controlled inputs and shared Zod schemas. Submit secrets directly in the credential request, then overwrite the local input value with an empty string in `finally`. Require the user to type or click explicit confirmation for an unknown fingerprint; never offer confirmation for `SSH_HOST_KEY_CHANGED`.

- [ ] **Step 4: Write failing AppDialog tests**

Cover DSH template values (`3080`, `npx @deepseek-ai/dsh web --no-open`), fixed local port, auto-start switch, conditional stop command, protocol/health path, preset/URL/upload/letter icon kinds, timeout fields, and a `LOCAL_PORT_IN_USE` response showing the conflicting app name. For upload, read the selected PNG/JPEG/WebP file as Base64, reject decoded content above 512 KiB in the browser, upload it first, then store the returned icon ID in `iconValue`.

- [ ] **Step 5: Run AppDialog tests and confirm failure**

Run: `npm run test:unit -- apps/web/src/components/app-dialog.test.tsx`

Expected: FAIL because `AppDialog` does not exist.

- [ ] **Step 6: Implement AppDialog**

Use tabs “应用配置”, “启动命令”, and “高级设置” inside the approved dark modal. Preserve user edits when switching tabs. Show remote and local ports side-by-side on desktop and stacked on narrow screens.

- [ ] **Step 7: Run dialog tests and commit**

Run: `npm run test:unit -- apps/web/src/components && npm run typecheck`

```powershell
git add apps/web/src
git commit -m "feat: configure SSH servers and remote applications"
```

---

### Task 12: Live Status, One-Click Open, Logs, and Errors

**Files:**
- Create: `apps/web/src/api/events.ts`
- Create: `apps/web/src/components/app-details-dialog.tsx`
- Modify: `apps/web/src/components/app-tile.tsx`
- Modify: `apps/web/src/components/app-grid.tsx`
- Modify: `apps/web/src/state/launchpad-store.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/api/events.test.ts`
- Test: `apps/web/src/components/app-tile.test.tsx`
- Test: `apps/web/src/components/app-details-dialog.test.tsx`

**Interfaces:**
- Consumes: `/api/events`, connect/disconnect/reconnect/log endpoints.
- Produces: `subscribeRuntimeEvents(onEvent): () => void` and the final application interaction model.

- [ ] **Step 1: Write failing EventSource adapter tests**

Inject an EventSource constructor. Assert snapshot and runtime JSON parsing, malformed-event ignore with a console warning that contains no payload, reconnect by native EventSource, and `close()` on unsubscribe.

- [ ] **Step 2: Run EventSource tests and confirm failure**

Run: `npm run test:unit -- apps/web/src/api/events.test.ts`

Expected: FAIL because the event adapter does not exist.

- [ ] **Step 3: Implement event subscription and reducer updates**

Map server events directly to app runtime records. Treat the server as authoritative; do not synthesize “healthy” from a successful POST alone.

- [ ] **Step 4: Write failing one-click-open tests**

```ts
it('opens a blank tab synchronously and navigates it after connection', async () => {
  const pending = { location: { href: 'about:blank' }, close: vi.fn() }
  vi.spyOn(window, 'open').mockReturnValue(pending as unknown as Window)
  api.connect.mockResolvedValue({ url: 'http://127.0.0.1:13080', status: 'healthy' })
  await user.click(screen.getByRole('button', { name: /DeepSeek Harness/ }))
  expect(window.open).toHaveBeenCalledWith('about:blank', '_blank')
  expect(pending.location.href).toBe('http://127.0.0.1:13080')
})
```

Also assert a failed connection closes the blank tab, a blocked popup displays instructions, green apps open immediately, and conflict/error apps open details rather than starting a blind retry.

- [ ] **Step 5: Implement AppTile interaction and status presentation**

Use gray, animated blue, green, yellow, and red status dots with text available to screen readers. Add a keyboard-accessible menu containing connect, open, disconnect, reconnect, edit, logs, and delete.

- [ ] **Step 6: Write and implement AppDetailsDialog tests**

Test concise error message, safe details, recommended action, retry button, disconnect button, and a 200-line maximum log view. Verify strings matching password/passphrase fixtures are absent.

- [ ] **Step 7: Run live-status tests and commit**

Run: `npm run test:unit -- apps/web/src && npm run typecheck`

```powershell
git add apps/web/src
git commit -m "feat: connect and monitor applications from the homepage"
```

---

### Task 13: Production Startup, Shutdown, and Static Delivery

**Files:**
- Create: `apps/server/src/config.ts`
- Create: `apps/server/src/main.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `package.json`
- Test: `apps/server/src/config.test.ts`
- Test: `apps/server/src/main.test.ts`

**Interfaces:**
- Consumes: all server modules and `apps/web/dist`.
- Produces: `resolvePaths(localAppData?: string): AppPaths`, `findControlPort(preferred: number): Promise<number>`, and `startLaunchpad(options?): Promise<RunningLaunchpad>`.

```ts
export interface RunningLaunchpad {
  url: string
  close(): Promise<void>
}
```

- [ ] **Step 1: Write failing path and port-selection tests**

Assert paths resolve below `%LOCALAPPDATA%\ssh-launchpad`, required directories are created, preferred control port is used when free, and an occupied control port causes selection of a free fallback without changing configured application tunnel ports.

- [ ] **Step 2: Run startup tests and confirm failure**

Run: `npm run test:unit -- apps/server/src/config.test.ts apps/server/src/main.test.ts`

Expected: FAIL because production composition does not exist.

- [ ] **Step 3: Implement the composition root**

Create the database and repositories, keyring store, server service, SSH pool, tunnel manager, event bus, runtime service, and Fastify app exactly once. Generate 32 random bytes for the session token. Listen on `127.0.0.1`, serve built frontend files, and return the actual URL.

- [ ] **Step 4: Implement browser launch and ordered shutdown**

On Windows, launch `rundll32.exe` with argument array `['url.dll,FileProtocolHandler', url]`, `shell: false`, and no interpolated command string. On `SIGINT` or `SIGTERM`: stop accepting HTTP, close SSE, call `runtime.shutdown()`, close SSH/tunnels, then close SQLite. Make repeated shutdown calls safe.

- [ ] **Step 5: Add root build/dev/start scripts**

`npm run build` must build shared, web, then server. `npm run dev` must watch shared/server/web concurrently. `npm start` must run the built server. Add a prestart check that prints a clear message when web assets are missing.

- [ ] **Step 6: Run startup tests and a local smoke run**

Run:

```powershell
npm run build
npm run test:unit -- apps/server/src/config.test.ts apps/server/src/main.test.ts
npm start
```

Expected: the console prints one `http://127.0.0.1:<port>` URL, the browser opens the homepage, and Ctrl+C releases that port.

- [ ] **Step 7: Commit production startup**

```powershell
git add package.json package-lock.json apps/server
git commit -m "feat: start and stop the local launchpad service"
```

---

### Task 14: End-to-End Workflow and Windows Credential Verification

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/launchpad.spec.ts`
- Create: `scripts/verify-windows-credential.ts`
- Create: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: the built product and public API only.
- Produces: repeatable full-flow tests, a real Windows keyring smoke command, and user documentation.

- [ ] **Step 1: Install Playwright and create the failing primary E2E test**

Run: `npm install -D @playwright/test && npx playwright install chromium`

The fixture starts an in-process SSH server, a remote HTTP app, and Launchpad with a temporary `%LOCALAPPDATA%`. The test must add a password server, confirm its fingerprint, add a DSH-style app using a fixed local port, click its icon, observe green status, verify the blank tab reaches the remote HTTP content through the tunnel, disconnect, and verify the local port becomes bindable.

- [ ] **Step 2: Run E2E and confirm the first failure**

Run: `npm run test:e2e -- tests/e2e/launchpad.spec.ts`

Expected: FAIL at the first missing fixture or behavior that prevents the full user flow.

- [ ] **Step 3: Complete deterministic E2E fixtures**

Use temporary directories and ports selected by binding to port 0. Inject an in-memory CredentialStore for automated E2E so CI never writes the developer's Windows vault. Ensure fixture teardown closes browser context, Launchpad, SSH server, remote HTTP server, and temporary files in that order.

- [ ] **Step 4: Add security and failure E2E cases**

Cover wrong password, changed host key, occupied local port, remote service closed with auto-start off, failed start command, and three-step reconnect exhaustion. Assert the UI presents the stable error code's user message and never displays submitted secrets.

- [ ] **Step 5: Run all browser tests**

Run: `npm run build && npm run test:e2e`

Expected: all Playwright tests PASS in Chromium.

- [ ] **Step 6: Add the real Windows Credential Manager smoke script**

The script writes a random value under a random account, reads it back, compares with `timingSafeEqual`, deletes it in `finally`, and prints only `Windows Credential Manager verification passed`. Add root script `verify:windows-credential` and skip with a clear non-zero error when `process.platform !== 'win32'`.

- [ ] **Step 7: Write the user README**

Document prerequisites, `npm install`, `npm run build`, `npm start`, first server setup, SSH Config import limits, DSH example (`3080`/`13080`), OpenClaw/custom apps, status colors, credential location, host-key behavior, shutdown semantics, troubleshooting by stable error code, tests, and the Windows credential verification command.

- [ ] **Step 8: Run the complete verification matrix**

Run:

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run test:e2e
npm run build
npm run verify:windows-credential
```

Expected: every command exits 0; coverage includes repository, credential, SSH, tunnel, runtime, API, and critical UI branches; the credential script leaves no test entry behind.

- [ ] **Step 9: Commit the verified first release**

```powershell
git add playwright.config.ts tests scripts README.md package.json package-lock.json
git commit -m "test: verify the complete SSH Launchpad workflow"
```

---

## Spec Coverage Map

- Spec sections 1–4 (goal, scope, selected approach): plan header, global constraints, and scope check.
- Spec sections 5–7 (architecture, stack, persistence): Tasks 1–8.
- Spec section 8 (approved page design): Tasks 10–12.
- Spec section 9 (add, connect, start, tunnel, disconnect, reconnect): Tasks 4–7 and 11–12.
- Spec section 10 (REST and SSE API): Task 9.
- Spec sections 11–13 (security, errors, lifecycle): Tasks 3, 5–7, 9, 12–13.
- Spec sections 14–15 (test strategy and acceptance): every task's test cycle plus Task 14 and the checklist below.

No independent spec requirement remains without an implementation task.

## Final Acceptance Checklist

- [ ] Add and persist three servers using password, private-key, and SSH Config authentication.
- [ ] Restart Launchpad and reconnect without re-entering saved secrets.
- [ ] Add multiple applications and reject duplicate fixed local ports.
- [ ] Connect DSH through `127.0.0.1:13080` to remote `127.0.0.1:3080`.
- [ ] Skip automatic startup when the remote port is already listening.
- [ ] Start a stopped POSIX remote application and wait for health.
- [ ] Block unknown host keys until confirmed and always block changed keys.
- [ ] Reuse one SSH session for multiple apps on the same server.
- [ ] Release every local listener on disconnect and shutdown.
- [ ] Keep remote applications running by default after local shutdown.
- [ ] Verify no database row, log line, API response, or browser state contains password/passphrase plaintext.
- [ ] Confirm the implemented homepage matches the approved navigation-page mockup at desktop and narrow widths.
