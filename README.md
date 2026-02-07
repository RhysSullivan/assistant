# Prototype Monorepo

This repository is now split into two nested monorepos:

- `assistant/`: assistant-side code and integrations.
- `executor/`: executor infrastructure (sandbox runtime, approvals API, task history, web UI).

## Focus Area

The active prototype work is in `executor/`.

## Quick Start

```bash
bun install --cwd executor
bun run --cwd executor dev
```

This starts:

- Executor API server (task execution, approvals, SQLite storage)
- Executor web UI (pending approvals + task history)
