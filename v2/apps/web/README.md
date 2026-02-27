# app-web

Basic Next.js frontend for Executor v2 control plane.

- Uses `@executor-v2/control-plane` Effect HttpApi client
- Uses Effect Atom (`@effect-atom/atom`, `@effect-atom/atom-react`) for query state
- Proxies backend calls through `/api/control-plane/*` via `next.config.ts` rewrites

Run:

- `bun run --cwd apps/web dev`
- Open `http://127.0.0.1:3000`

By default, proxy target is `http://127.0.0.1:8787`.
Override with `CONTROL_PLANE_UPSTREAM_URL`.
