# Executor Menubar MVP

Minimal macOS tray wrapper for the React console.

It opens a compact menubar panel at `http://localhost:4312/menubar`, so it reuses existing web hooks and auth/session behavior.

## Run

1. Start the web app:

```bash
bun run dev:executor:web
```

2. Start the menubar app:

```bash
bun run --cwd executor/apps/menubar dev
```

Optional override:

```bash
EXECUTOR_MENUBAR_TARGET_URL=http://localhost:4312/menubar bun run --cwd executor/apps/menubar dev
```
