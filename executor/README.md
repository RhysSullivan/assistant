# Executor Monorepo

Prototype executor control plane for running AI-generated code with tool-call approval gates.

## What Is Here

- `apps/server`: Bun server with:
  - task execution API
  - per-tool-call approval API
  - task event stream (SSE)
  - SQLite-backed task and approval history
  - pluggable sandbox runtime interface
- `apps/web`: web interface for:
  - pending approvals
  - task history
  - task details/logs
- `packages/contracts`: shared API/types
- `packages/client`: lightweight client SDK for other consumers (including assistant-side integrations)

## Architecture Notes

- The runtime executes generated code and exposes a `tools.*` proxy to that code.
- The generated-code runtime uses an `ExecutionAdapter` boundary for tool calls and output streaming.
- Current default uses an in-process adapter; an HTTP adapter is also included for process/network boundaries.
- Tools can be marked `auto` or `required` approval.
- Required tools create approval records per function call (`toolPath` + `input`).
- Task execution pauses on required tool calls until that specific call is approved or denied.
- Runtime targets are swappable by ID (`runtimeId`) so sandbox backends can change later.
- SQLite is used as a prototype event/history store.

## Vercel Sandbox Runtime

This repo includes a `vercel-sandbox` runtime that runs generated code in Vercel Sandbox VMs while keeping the same `await tools.*(...)` flow.

Local setup:

```bash
vercel project add <project-name>
vercel link --yes --project <project-name>
vercel env pull .env.local --yes
```

Required runtime env:

- `VERCEL_OIDC_TOKEN` (pulled by `vercel env pull`)
- `EXECUTOR_INTERNAL_BASE_URL` (optional override for callback URL; if unset, server can auto-bootstrap a Tailscale Funnel URL in dev)

Optional:

- `EXECUTOR_INTERNAL_TOKEN` (shared bearer token for internal callback routes; auto-generated if unset)
- `EXECUTOR_VERCEL_SANDBOX_RUNTIME` (`node22` by default, supports `node24`)
- `EXECUTOR_AUTO_TAILSCALE_FUNNEL` (`1` by default; set `0` to disable automatic `tailscale funnel --bg` bootstrap)

When creating tasks, set `runtimeId` to `vercel-sandbox` to use this backend.

## Run

```bash
bun install
bun run dev
```

Server defaults to `http://localhost:4001`.
