# Single Server SSH Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Agent-pairing architecture with one public service that stores server/app records, accepts browser-held credentials per operation, and executes SSH tunnels on the deployed server.

**Architecture:** The control plane becomes the only runtime. It owns the existing SQLite repositories, SSH session pool, tunnel manager, runtime service, logs, and HTTP relay. The browser stores passwords in localStorage without an application TTL and sends them only over HTTPS in JSON requests; the server keeps them in memory for the operation and never persists them. Agent WebSocket, pairing, and Agent setup UI are removed from the active path.

**Tech Stack:** Fastify 5, Node.js 24+, `ssh2`, SQLite `node:sqlite`, React/Vite, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-24-ssh-launchpad-agent-control-design.md` (superseded for this single-server mode; browser-only credential requirement in this plan is authoritative).

## Global Constraints

- `CONTROL_TOKEN`, `SESSION_SECRET`, and `PUBLIC_BASE_URL` remain required for the public service.
- Passwords must never be written to SQLite, server logs, cookies, URLs, or pairing records.
- Browser credential storage has no application TTL but browser clearing or profile changes can remove it.
- The public service must expose only HTTP(S); SSH and application local ports stay server-side.
- `npm start` runs the complete web/API/SSH service; `npm run agent:start` is not required.

---

### Task 1: Portable browser-credential request contract

**Files:**
- Modify: `packages/shared/src/contracts.ts`
- Modify: `packages/shared/src/errors.ts`
- Test: `packages/shared/src/contracts.test.ts` or existing shared validation tests

**Interfaces:** Add optional `credential` to server create/update/test/connect/reconnect request payloads at the API boundary. Keep `CredentialKind` as `password | private-key-passphrase`; never add credential fields to `ServerRecord`.

- [ ] Add shared request types and validation helpers that accept `{ kind, value }` only when supplied.
- [ ] Add tests rejecting empty credential values and accepting password/private-key-passphrase values.
- [ ] Run `npm run test:unit -- packages/shared` and verify the new cases pass.
- [ ] Commit as `feat: define browser credential request contract`.

### Task 2: Make server runtime portable and constructible by Control Plane

**Files:**
- Create: `apps/server/src/runtime-system.ts`
- Modify: `apps/server/src/credentials/keyring-store.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/package.json`
- Modify: `apps/control-plane/package.json`
- Modify: root `package.json` build order

**Interfaces:** Export `createRuntimeSystem(options)` returning repositories, `ServerService`, connection service, runtime, events, logs, database, and a `CredentialStore` implementation. Add `createServerRuntimeSystem` for browser-credential mode whose `set/get/delete` methods throw `CREDENTIAL_UNAVAILABLE` because credentials are request-scoped and never persisted.

- [ ] Extract operational service construction from the Agent-only main into an importable factory.
- [ ] Add an in-memory/request-scoped credential adapter used only when a request supplies a credential.
- [ ] Keep the existing Windows Agent path unchanged for backwards compatibility, but remove its need from the public web path.
- [ ] Add a focused factory test proving no credential write is attempted.
- [ ] Run server typecheck and tests.
- [ ] Commit as `feat: expose portable server runtime factory`.

### Task 3: Single-server Control Plane API and HTTP relay

**Files:**
- Modify: `apps/control-plane/src/control-app.ts`
- Modify: `apps/control-plane/src/control-routes.ts`
- Create: `apps/control-plane/src/single-server-runtime.ts`
- Modify: `apps/control-plane/src/main.ts`
- Test: `apps/control-plane/src/control-routes.test.ts`

**Interfaces:** Browser API routes call the local runtime directly. `POST /api/servers`, `PATCH /api/servers/:id`, `POST /api/servers/:id/test`, `POST /api/apps/:id/connect`, and `POST /api/apps/:id/reconnect` may receive `credential`. `GET/POST /tunnel/:appId/*` forwards to the local app through the server-side tunnel manager.

- [ ] Remove Agent selection and `AGENT_OFFLINE` responses from the active API path.
- [ ] Forward credentials into server create/update/test/connect operations without storing them.
- [ ] Return public tunnel URLs as `${PUBLIC_BASE_URL}/tunnel/${appId}/`.
- [ ] Add local relay tests proving status, headers, and Base64 body forwarding.
- [ ] Run control-plane route tests with an in-memory database.
- [ ] Commit as `feat: execute SSH operations in control plane`.

### Task 4: Remove pairing UI and persist password only in browser storage

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/state/launchpad-store.tsx`
- Modify: `apps/web/src/app.tsx`
- Create: `apps/web/src/state/browser-credentials.ts`
- Delete or deactivate: `apps/web/src/components/control-gate.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:** `browserCredentials.get(serverId)`, `set(serverId, credential)`, and `remove(serverId)` use localStorage with no TTL. Login remains token-based; after login, `bootstrap` directly opens the workspace. Server/app operations include the selected browser credential.

- [ ] Add localStorage serialization with a versioned key and no expiry timestamp.
- [ ] Add password inputs to server/app quick configuration and hydrate saved values for the current browser.
- [ ] Remove Agent Setup screen and pairing-code API calls from the normal flow.
- [ ] Ensure no password is rendered into URLs, DOM text, logs, or error messages.
- [ ] Run web typecheck/build and browser-store tests.
- [ ] Commit as `feat: store SSH credentials in browser only`.

### Task 5: Deployment and migration documentation

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `apps/server/README.md`
- Modify: `apps/control-plane/package.json`

**Interfaces:** `npm start` and `docker compose up -d --build` start only the single service. Documentation explicitly says no Agent process is needed and explains HTTPS, reverse proxy, server-side SSH reachability, and browser-cache limitations.

- [ ] Remove pairing-code and Agent startup instructions from the primary deployment path.
- [ ] Add server firewall and Nginx/WebSocket-independent HTTP reverse proxy notes.
- [ ] State that browser storage is not a backup and can be cleared by the browser.
- [ ] Run full lint, typecheck, unit tests, and build.
- [ ] Commit as `docs: document single-server deployment`.
