# SSH Launchpad Agent + Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make SSH Launchpad self-hostable as a public control plane plus local Windows Agent, keeping SSH secrets and execution on the Agent.

**Architecture:** Keep the existing SSH/runtime modules in the server workspace and run them as an outbound WebSocket Agent. Add a Fastify control-plane workspace that authenticates browsers, pairs Agents, forwards typed JSON RPC, emits SSE events, and relays HTTP application requests. The React app uses the control-plane API and public relay URLs.

**Tech Stack:** Node.js >=24.14, TypeScript/NodeNext, Fastify, `ws`, SQLite, `@napi-rs/keyring`, `ssh2`, React, Vite, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-24-ssh-launchpad-agent-control-design.md`

## Global Constraints

- SSH passwords, private-key passphrases, and private-key files never leave the Agent.
- Agent WebSocket connections are outbound; no inbound Agent listener is required.
- Public browser mutations require an HttpOnly SameSite session cookie.
- Pairing codes expire after 10 minutes and are single-use.
- Relay exposes authenticated HTTP application paths only; it does not expose raw SSH or TCP ports.
- Preserve the existing local SQLite database and Windows Credential Manager records for the Agent.

---

### Task 1: Shared Agent Protocol and Errors

**Files:**
- Modify: `packages/shared/src/errors.ts`
- Create: `packages/shared/src/agent-protocol.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/agent-protocol.test.ts`

**Interfaces:**
- Produces `AgentMethod`, `AgentMessage`, `AgentRequest`, `AgentResponse`, `AgentEvent`, `AgentDescriptor`, and `AgentErrorBody`.

- [ ] Add stable `AGENT_OFFLINE`, `AGENT_TIMEOUT`, `PAIRING_INVALID`, and `SESSION_INVALID` error codes.
- [ ] Define discriminated JSON envelopes and an exhaustive parser that rejects missing IDs, unknown message types, and oversized Base64 payloads.
- [ ] Test valid pair/hello/request/response/event messages and invalid envelopes.
- [ ] Run `npm run test:unit -- packages/shared/src/agent-protocol.test.ts && npm run typecheck`.
- [ ] Commit `feat: define control plane agent protocol`.

### Task 2: Control-Plane Authentication, Pairing, and Agent Registry

**Files:**
- Create: `apps/control-plane/package.json`
- Create: `apps/control-plane/tsconfig.json`
- Create: `apps/control-plane/src/control-database.ts`
- Create: `apps/control-plane/src/auth/session-service.ts`
- Create: `apps/control-plane/src/agents/agent-registry.ts`
- Create: `apps/control-plane/src/agents/pairing-service.ts`
- Test: `apps/control-plane/src/auth/session-service.test.ts`
- Test: `apps/control-plane/src/agents/pairing-service.test.ts`

**Interfaces:**
- `SessionService.exchange(token): string`, `SessionService.verify(cookie): boolean`.
- `PairingService.create(): { code: string; expiresAt: string }`, `consume(code, socket): AgentDescriptor`.
- `AgentRegistry.list()`, `get(id)`, `attach()`, `detach()`, `sendRequest()`.

- [ ] Add the control-plane workspace and install Fastify, `@fastify/cookie`, `@fastify/websocket`, `@fastify/static`, `ws`, and `@types/ws`.
- [ ] Store sessions, pairing codes, and Agent metadata in a SQLite database under `CONTROL_DATA_DIR`; hash session secrets and expire pairing codes after ten minutes.
- [ ] Test token exchange, invalid session rejection, one-time pairing, expiry, and offline transitions.
- [ ] Commit `feat: add control plane sessions and agent pairing`.

### Task 3: Agent WebSocket RPC Client

**Files:**
- Create: `apps/server/src/agent/agent-client.ts`
- Create: `apps/server/src/agent/agent-rpc-handler.ts`
- Modify: `apps/server/src/main.ts`
- Create: `apps/server/src/agent/agent-client.test.ts`

**Interfaces:**
- `AgentClient.start(): Promise<void>`, `stop(): Promise<void>`.
- `AgentRpcHandler.handle(method, payload): Promise<unknown>`.

- [ ] Replace the current local Fastify startup with an Agent process that reads `CONTROL_URL`, `PAIRING_CODE`, and `AGENT_NAME`.
- [ ] Implement pairing, token persistence, reconnect backoff, request correlation, ten-second RPC timeout, and event forwarding.
- [ ] Route RPC methods to existing repositories, `ServerService`, `ServerConnectionService`, `AppRuntimeService`, and a new proxy handler.
- [ ] On `apps.connect` unknown fingerprint, call `rememberCandidate` before returning the structured error so the browser confirmation remains one-click.
- [ ] Test request correlation, timeout, reconnect, and mapping of Launchpad errors without leaking secrets.
- [ ] Commit `feat: run SSH operations through a paired outbound agent`.

### Task 4: Control-Plane API and WebSocket Gateway

**Files:**
- Create: `apps/control-plane/src/control-app.ts`
- Create: `apps/control-plane/src/agent-gateway.ts`
- Create: `apps/control-plane/src/api/routes.ts`
- Create: `apps/control-plane/src/api/events.ts`
- Test: `apps/control-plane/src/api/routes.test.ts`
- Test: `apps/control-plane/src/agent-gateway.test.ts`

**Interfaces:**
- `buildControlApp(dependencies): Promise<FastifyInstance>`.
- `AgentGateway.request(agentId, method, payload): Promise<unknown>`.

- [ ] Add `POST /api/session`, `GET /api/control/status`, `POST /api/agents/pairing-codes`, `GET /api/agents`, and `GET /agent` WebSocket endpoints.
- [ ] Mirror existing server/app CRUD and runtime endpoints by forwarding typed methods to the selected Agent.
- [ ] Return the same structured error shape and status mapping as the current API.
- [ ] Subscribe control-plane SSE clients to Agent runtime/log events and emit an initial snapshot.
- [ ] Test session enforcement, offline errors, RPC success/failure, SSE formatting, and pairing WebSocket handshakes.
- [ ] Commit `feat: expose authenticated control plane APIs`.

### Task 5: Agent HTTP Relay

**Files:**
- Create: `apps/server/src/agent/http-proxy.ts`
- Create: `apps/control-plane/src/tunnel/http-relay.ts`
- Test: `apps/server/src/agent/http-proxy.test.ts`
- Test: `apps/control-plane/src/tunnel/http-relay.test.ts`

**Interfaces:**
- `proxyLocalApp(appId, method, path, headers, body): Promise<ProxyResponse>`.
- `HttpRelay.handle(request, reply): Promise<void>`.

- [ ] Proxy only to an Agent runtime's local URL after the app is healthy; reject absolute URLs and hop-by-hop headers.
- [ ] Preserve status, content type, cache headers, and binary data with a 10 MiB response limit.
- [ ] Return `/tunnel/:agentId/:appId/` from control-plane app connect responses and forward authenticated subpaths.
- [ ] Test HTML, JSON, binary response, disconnected app, invalid path, and oversized response behavior.
- [ ] Commit `feat: relay authenticated application traffic through agents`.

### Task 6: Web UI Authentication, Agent Setup, and Public URLs

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/state/launchpad-store.tsx`
- Create: `apps/web/src/components/control-login.tsx`
- Create: `apps/web/src/components/agent-setup.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/state/launchpad-store.test.tsx`

**Interfaces:**
- `api.exchangeSession(token)`, `api.controlStatus()`, `api.createPairingCode()`.

- [ ] On `SESSION_INVALID`, render a login card and exchange the user-provided `CONTROL_TOKEN` for an HttpOnly session.
- [ ] When no Agent is online, render an Agent setup card with pairing code, command, expiry, and copy button.
- [ ] Use the control-plane URL returned by connect instead of `127.0.0.1` and keep the fingerprint confirmation behavior.
- [ ] Test login, offline setup, pairing-code refresh, and public connect URL navigation.
- [ ] Commit `feat: support public control plane setup in the web UI`.

### Task 7: Self-Hosted Packaging and Documentation

**Files:**
- Create: `.env.example`
- Create: `Dockerfile.control-plane`
- Create: `docker-compose.yml`
- Modify: `package.json`
- Modify: `README.md`
- Create: `apps/control-plane/src/main.ts`
- Create: `apps/server/README.md`
- Test: `scripts/smoke-control-plane.mjs`

**Interfaces:**
- `npm run control:build`, `npm run control:start`, `npm run agent:start`.

- [ ] Add environment validation for `CONTROL_TOKEN`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, `CONTROL_URL`, and `AGENT_NAME`.
- [ ] Build the web bundle into the control plane and listen on `0.0.0.0` only in the control process.
- [ ] Document Docker deployment, Agent pairing, reverse proxy HTTPS, backup, token rotation, and HTTP relay limitations.
- [ ] Add a smoke script that starts the control plane with temporary data, exchanges a session, creates a pairing code, and shuts down.
- [ ] Run full lint/typecheck/unit/build/smoke checks and commit `feat: package self-hosted control plane and agent`.
