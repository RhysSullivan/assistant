# OpenAssistant

## Install

```bash
bun install
```

## Local MVP (remote executor mode)

Start the executor (private code runner):

```bash
bun run --filter '@openassistant/executor' dev
```

Start the server (agent + approvals + tool broker):

```bash
OPENASSISTANT_EXECUTOR_URL=http://localhost:3001 \
OPENASSISTANT_CALLBACK_BASE_URL=http://localhost:3000 \
bun run --filter '@openassistant/server' dev
```

Or run all services together:

```bash
bun run dev
```

## Notes

- Untrusted generated code executes in the executor service.
- Tool calls are proxied back to the server via `/internal/runs/:runId/invoke`.
- Approval flow and secret-backed tool execution stay on the server side.
