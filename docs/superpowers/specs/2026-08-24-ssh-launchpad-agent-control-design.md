# SSH Launchpad Agent + Control Plane Design

## Goal

Replace the single-machine HTTP entry point with a self-hostable public control plane and a local Windows Agent. A user can download the repository, deploy the control plane, pair one or more Agents, and manage SSH applications from any browser without uploading SSH secrets.

## Scope

The repository provides two deployables:

1. `apps/control-plane`: public HTTPS-facing Fastify service. It owns browser authentication, Agent pairing, WebSocket RPC, SSE fan-out, and an HTTP application relay.
2. `apps/server`: renamed operationally as the Agent process. It owns SQLite configuration, Windows Credential Manager, SSH sessions, fingerprints, remote start commands, local tunnels, health checks, and the Agent WebSocket client.

The existing React app is served by the control plane and talks only to the control-plane API. There is no supported standalone local web mode after this change.

## Data and trust model

- The control plane stores account/session metadata, paired Agent metadata, and no SSH password, private-key passphrase, or private-key file.
- The Agent stores server/application configuration in `%LOCALAPPDATA%\\ssh-launchpad\\launchpad.db` and secrets in Windows Credential Manager.
- Pairing uses a six-character, ten-minute code created by an authenticated control-plane session. The code is consumed once and exchanged for an Agent token.
- Agent reconnects use the Agent token over `wss://` (or `ws://` for local self-hosted development). Tokens can be revoked from the control plane.
- Every browser mutation requires an HttpOnly SameSite session cookie. Public deployments require `CONTROL_TOKEN` for the initial session exchange and should run behind HTTPS.
- The control plane binds to `0.0.0.0` only when explicitly deployed; the Agent makes outbound WebSocket connections and does not open an inbound control port.

## Protocol

WebSocket messages are JSON envelopes:

```ts
type AgentMessage =
  | { type: 'pair'; code: string; name: string }
  | { type: 'hello'; agentId: string; token: string; name: string }
  | { type: 'request'; id: string; method: AgentMethod; payload: unknown }
  | { type: 'response'; id: string; ok: true; result: unknown }
  | { type: 'response'; id: string; ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
  | { type: 'event'; event: RuntimeEvent }
```

The initial method set is `bootstrap`, `servers.list`, `servers.create`, `servers.update`, `servers.remove`, `servers.test`, `servers.confirmFingerprint`, `servers.setCredential`, `servers.deleteCredential`, `apps.list`, `apps.create`, `apps.update`, `apps.remove`, `apps.connect`, `apps.disconnect`, `apps.reconnect`, `apps.logs`, and `apps.proxy`.

## Remote application relay

When an Agent reports a healthy application, the control plane returns a URL under `/tunnel/:agentId/:appId/`. Requests to that URL are authenticated by the browser session and forwarded over Agent RPC to the Agent's loopback application URL. The first version is HTTP request/response relay; it preserves status and safe content headers and returns binary bodies as Base64. Raw SSH ports are never exposed publicly.

## Failure handling

- No paired Agent: API returns `AGENT_OFFLINE` with a setup hint.
- Agent disconnect: control plane marks it offline and emits a runtime event; the Agent reconnects with bounded exponential backoff.
- RPC timeout: control plane returns `AGENT_TIMEOUT` and clears the pending request.
- Unknown SSH fingerprint: the Agent returns `SSH_HOST_KEY_UNKNOWN`, control plane stores no trust decision, and the existing one-click browser confirmation flow calls `servers.confirmFingerprint` before retrying.
- Relay request while app is disconnected: `AGENT_OFFLINE` or `REMOTE_PORT_CLOSED` is returned; the relay never starts a new SSH session implicitly.

## Deployment

- `docker compose up -d control-plane` runs the public service with `CONTROL_TOKEN`, `SESSION_SECRET`, `PUBLIC_BASE_URL`, and `PORT`.
- `npm run agent:start` runs the Windows Agent with `CONTROL_URL`, `PAIRING_CODE` on first run, and `AGENT_NAME`.
- `.env.example`, `Dockerfile.control-plane`, and `docker-compose.yml` document the self-hosted setup.
- Existing local-only data remains readable by the Agent; the browser no longer connects directly to port 4318.
