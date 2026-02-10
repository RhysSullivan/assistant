# Executor

Executor is a Convex-native execution platform for MCP-driven agents. It provides:

- task execution (`run_code`) with tool invocation and approval gates
- workspace-scoped policy, credentials, and tool source management
- MCP endpoints (Convex HTTP routes and a standalone Bun gateway)
- a Next.js web app for tasks, approvals, tools, members, and billing
- a binary-first install flow for local self-hosted runtime

## Architecture Overview

Core components:

- `convex/`: control plane data model and domain APIs (tasks, approvals, policies, credentials, org/workspace auth, billing).
- `convex/http.ts`: HTTP routes for `/mcp`, OAuth discovery metadata, and internal runtime callbacks.
- `convex/executorNode.ts`: task runner action (`runTask`) and tool invocation plumbing.
- `lib/`: runtime engine, typechecker, tool discovery, external source adapters (MCP/OpenAPI/GraphQL), credential provider resolvers.
- `mcp-gateway.ts`: standalone stateful MCP gateway with anonymous OAuth and optional WorkOS token verification.
- `apps/web/`: operator UI (dashboard, tasks, approvals, tools, onboarding, org settings).
- `executor.ts`: CLI entrypoint used by local source scripts and compiled binary releases.

Execution flow (high level):

1. Client submits code via MCP `run_code`.
2. `createTask` stores a queued task in Convex and schedules `runTask`.
3. `runTask` runs code in the local runtime adapter and resolves tool calls.
4. Tool policies can auto-allow, require approval, or deny.
5. Output, events, approvals, and terminal state are persisted and streamed to clients/UI.

## Running From Source (Inside This Monorepo)

From the monorepo root:

```bash
bun install
cp .env.example .env
```

Set at least:

- `CONVEX_DEPLOYMENT`
- `CONVEX_URL`

Then start executor services (separate terminals):

```bash
# Terminal 1: Convex dev watcher
bun run dev:executor:convex

# Terminal 2: Web UI
bun run dev:executor:web

# Terminal 3 (optional but recommended for stateful MCP transport)
bun run --cwd executor dev:mcp-gateway
```

Default source-dev endpoints:

- Web UI: `http://localhost:4312`
- MCP gateway: `http://localhost:4313/mcp`
- Gateway health: `http://localhost:4313/health`
- Convex HTTP MCP route: `<CONVEX_SITE_URL>/mcp`

## Binary Install (No Global Bun/Node/Convex Required)

```bash
curl -fsSL https://executor.sh/install | bash
```

The installed `executor` binary manages its own runtime under `~/.executor/runtime` by default, including:

- managed `convex-local-backend` binary
- managed Node runtime and Convex CLI bootstrap tooling
- packaged web bundle
- local backend config (`instanceName`, `instanceSecret`, ports)
- local SQLite data and file storage

Common binary commands:

```bash
executor doctor
executor up
executor backend --help
executor web
executor gateway
```

Uninstall:

```bash
bash executor/uninstall --yes
```

Default managed-runtime ports:

- backend API: `5410`
- backend site proxy: `5411`
- packaged web app: `5312`
- MCP gateway: `5313`

## CLI Commands (executor/package.json)

Run these from `executor/`:

```bash
bun run doctor
bun run up
bun run backend -- --help
bun run web
bun run gateway
bun run codegen
bun run deploy
bun run build:binary
bun run build:release
```

Notes:

- `build:binary` compiles a host-native `dist/executor` binary.
- `build:release` builds multi-platform binary archives and a host-platform web bundle in `dist/release/`.

## MCP and OAuth Surface

Gateway routes (`mcp-gateway.ts`):

- `/mcp` (GET/POST/DELETE)
- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-authorization-server`
- `/oauth2/jwks`
- `/register`
- `/authorize`
- `/token`
- `/health`

Convex HTTP routes (`convex/http.ts`) also expose:

- `/mcp` (direct Convex MCP transport)
- `/internal/runs/:runId/tool-call`
- `/internal/runs/:runId/output`

Anonymous OAuth is always available on the standalone gateway. WorkOS token verification is enabled when `MCP_AUTHORIZATION_SERVER` (or `MCP_AUTHORIZATION_SERVER_URL`) is configured.

## Configuration Reference

Important env vars (see root `.env.example` for the base template):

- Core:
  - `CONVEX_URL`
  - `CONVEX_SITE_URL`
- WorkOS (optional auth/org features):
  - `WORKOS_CLIENT_ID`
  - `WORKOS_API_KEY`
  - `WORKOS_WEBHOOK_SECRET`
  - `WORKOS_COOKIE_PASSWORD`
- Billing (optional):
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  - `STRIPE_PRICE_ID`
- MCP auth integration:
  - `MCP_AUTHORIZATION_SERVER` or `MCP_AUTHORIZATION_SERVER_URL`
- Managed runtime and gateway:
  - `EXECUTOR_RUNTIME_DIR`
  - `EXECUTOR_BACKEND_PORT`
  - `EXECUTOR_BACKEND_SITE_PORT`
  - `EXECUTOR_WEB_PORT`
  - `EXECUTOR_MCP_GATEWAY_PORT`
  - `EXECUTOR_INTERNAL_TOKEN` (recommended for Convex-backed anonymous OAuth key/client persistence)
  - `NEXT_PUBLIC_LOCAL_MCP_ORIGIN`

## Credential Providers

`sourceCredentials` supports:

- `managed`: stores credential payload in Convex (`secretJson`)
- `workos-vault`: stores encrypted payload in WorkOS Vault and keeps a reference in Convex

`workos-vault` uses `WORKOS_API_KEY` for vault reads. Existing object references can be imported with `secretJson.objectId`.

## Testing and Validation

From `executor/`:

```bash
bun test
```

From repo root:

```bash
bun run test:executor
bun run typecheck:executor
```

## Repository Layout

```text
executor/
|- apps/web/                 # Next.js operator UI
|- convex/                   # Convex functions, schema, auth, HTTP routes
|- lib/                      # runtime, tool loading/discovery, gateway helpers
|- scripts/build-release.ts  # release artifact builder
|- executor.ts               # CLI entrypoint (compiled into binary)
|- mcp-gateway.ts            # standalone MCP + OAuth gateway
|- install                   # curl install script
`- uninstall                 # uninstall script
```

## Troubleshooting

- `401` on `/mcp`: the gateway expects OAuth bearer tokens; complete MCP OAuth client flow first.
- Web UI cannot load data: verify `CONVEX_URL` / `CONVEX_SITE_URL` and that Convex dev is running.
- Gateway OAuth state resets between restarts: set `EXECUTOR_INTERNAL_TOKEN` so gateway can persist keys/clients in Convex.
- Release build missing web archive for your platform: run `bun run build:release` on that target platform.
