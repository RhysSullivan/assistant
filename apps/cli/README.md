# app-cli

Executor CLI thin-client scaffold.

The CLI proxies all operations to an Executor server target:

- `local` target: connects to `http://127.0.0.1:8788` and auto-starts an embedded
  Executor API server subprocess if the local server is not already running.
- `cloud` target: proxies to a configured remote base URL.

Implementation note:

- CLI parsing/help/completion behavior is powered by `@effect/cli`.
- Local CLI server hosting and web API routing both use `@executor-v2/api-http` so
  request/response handling stays in sync.

Supported commands:

- `executor init`
- `executor auth login --client-id ...`
- `executor auth status`
- `executor server start`
- `executor target show`
- `executor target use <local|cloud>`
- `executor workspace current`
- `executor workspace use <workspace-id>`
- `executor run execute --code ...`
- `executor run execute --file ...`
- `executor run bootstrap openapi --spec-url ... --source-base-url ...`
- `executor run bootstrap github`

Run locally:

- `bun run --cwd apps/cli start -- target show`
- `bun run --cwd apps/cli start -- run execute --target local --code "return 1"`
- `bun run --cwd apps/cli start -- run bootstrap github --target local`
- `bun run --cwd apps/cli start -- --help`
- `bun run --cwd apps/cli start -- server start --port 8788`
