## AGENTS.md - Monorepo Agent Guide

This file is for coding agents working in `/home/rhys/assistant`.
It captures project architecture, commands, and code conventions observed in-repo.

## Rule Sources Checked

- Checked for Cursor rules: `.cursor/rules/**` and `.cursorrules` (none found).
- Checked for Copilot rules: `.github/copilot-instructions.md` (none found).
- If any of these files are added later, treat them as highest-priority supplements.

## Monorepo Layout

- `executor/`: primary execution platform (Convex backend, runtimes, Next.js web app, release tooling).
- `assistant/`: assistant server + Discord bot + shared core loop + `reacord` package.
- `sources/`: Bun service that syncs API catalog data into SQLite.
- `dev.ts`: root multi-service dev orchestrator.
- `.env.example`: canonical environment template for all projects.

## Runtime and Package Manager

Default to Bun across this repository.

- Use `bun install` for dependencies.
- Use `bun run <script>` for scripts.
- Use `bun test` for tests.
- Use `bunx <tool>` for one-off CLIs.
- Bun auto-loads `.env`; avoid adding `dotenv` unless there is a hard requirement.

## Build, Lint, Test, Typecheck Commands

Run from repo root unless noted.

### Main quality commands

- `bun run test` - runs executor + assistant test suites.
- `bun run typecheck` - runs executor + assistant TypeScript checks.
- `bun run knip` - dead-code/unused-export scan.

### Package-specific quality commands

- `bun run test:executor` - `bun test --cwd executor`.
- `bun run test:assistant` - assistant tests (`assistant/packages/core/src`).
- `bun run typecheck:executor` - `tsc --noEmit -p executor/tsconfig.json`.
- `bun run typecheck:assistant` - checks server + bot tsconfig files.
- `bun run --cwd executor/apps/web lint` - ESLint for Next.js web app.

- `bun run --cwd executor build:binary` / `build:release` - binary + release artifacts.
- `bun run --cwd executor/apps/web build` - Next.js production build.

### Dev commands

- `bun run dev` - starts sources, convex dev, sandbox worker, web, assistant, optional bot.
- `bun run kill:all` - stop processes started by `dev.ts`.
- `bun run dev:executor:web` / `bun run dev:assistant` / `bun run dev:bot` - focused dev loops.

### Run a single test file (important)

- `bun test executor/packages/core/src/tool-discovery.test.ts`
- `bun test executor/packages/convex/access-controls.test.ts`
- `bun test assistant/packages/core/src/agent.test.ts`

### Run a single test by name

- `bun test executor/packages/core/src/tool-discovery.test.ts --test-name-pattern "discover returns aliases"`
- `bun test --test-name-pattern "workspace admin can upsert access policies"`

## High-Level Architecture

### Executor (core platform)

- Convex functions in `executor/packages/convex/**` own tasks, authz, approvals, billing, and persistence.
- MCP HTTP surface is defined in `executor/packages/convex/http.ts` (`/mcp`, `/mcp/anonymous`, OAuth metadata routes).
- Runtime/tool engine logic lives in `executor/packages/core/src/**`.
- Sandbox host for Cloudflare worker runtime is `executor/packages/runner-sandbox-host`.
- Operator UI is Next.js in `executor/apps/web` and loads a client-side React Router app shell.

### Assistant

- `assistant/packages/server`: Elysia API that resolves user context and invokes core agent.
- `assistant/packages/core`: model + MCP tool loop.
- `assistant/packages/bot`: Discord integration and link flows.
- `assistant/packages/reacord`: Effect-based Discord React reconciler package.

- `sources/`: Bun HTTP sync service + SQLite catalog ingester.

## How To Write Code Here

### TypeScript and typing

- Project is strict TS (`strict: true` broadly enabled); keep new code fully typed.
- Prefer explicit interfaces/types for public function boundaries.
- Use `type`-only imports where possible (`import type { ... }`).
- Use existing shared types (`executor/packages/core/src/types.ts`) before inventing duplicates.
- In Convex code, validate inputs with `v.*` validators and preserve arg schemas.

### Imports and module boundaries

- Keep imports grouped: external packages first, workspace/internal modules second.
- Web app uses `@/` aliases inside `executor/apps/web`.
- Avoid deep cross-package reach-ins unless already established by the package.
- Do not edit generated Convex files under `executor/packages/convex/_generated/**`.

### Naming and file conventions

- Prefer `camelCase` for variables/functions and `PascalCase` for React components/types.
- Match local file naming conventions:
  - Web UI files are mostly `kebab-case.ts(x)`.
  - Some executor/convex internals use `snake_case.ts`.
- Keep existing API/event string names unchanged unless migration is intentional.

### Formatting and style

- No single formatter is enforced across all packages; preserve local style per file.
- Many backend files use semicolons; many shadcn-style UI primitives omit semicolons.
- Do not perform broad reformat-only edits.
- Follow existing section-divider comment style when useful (the `// --------` blocks).

### Error handling

- Fail fast on invalid inputs with clear `Error` messages.
- Wrap external/network calls and include status/context in thrown errors.
- For recoverable UI/API flows, return structured errors instead of swallowing failures.
- In Convex auth/access paths, use existing access helpers (`workspaceMutation`, `workspaceQuery`, etc.).
- Preserve best-effort behavior where already intended (e.g., scheduler prewarm calls in `try/catch`).

### Framework-specific patterns

- Prefer Bun-native APIs for new runtime services (`Bun.serve`, `Bun.file`, `bun:sqlite`) unless package context requires Node APIs.
- In Next routes and async boundaries, use existing `Result.try` / `Result.tryPromise` patterns where present.
- For Convex functions, keep public APIs in top-level files (`workspace.ts`, `organizations.ts`) and DB access in `database/**`.
- In React, reuse existing UI primitives and helpers (`cn`, shadcn components, shared hooks).

## Testing Guidelines

- Use `bun:test` (`import { test, expect } from "bun:test"`).
- Keep tests close to code with `.test.ts` / `.e2e.test.ts` naming.
- When changing Convex auth/access logic, add/adjust permission tests in `executor/packages/convex/access-controls.test.ts`.
- When changing tool discovery/typing behavior, update tests in `executor/packages/core/src/*.test.ts`.

## Generated/Build Artifacts

- Do not manually edit generated/build outputs such as:
  - `executor/packages/convex/_generated/**`
  - `.next/**`
  - `dist/**` (unless task is explicitly about release artifacts)

## Environment and Secrets

- Use `.env.example` as the source-of-truth variable list.
- Never hardcode secrets/tokens in code or tests.
- Redact secrets in logs and API responses (follow existing credential redaction patterns).

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `.reference/effect/` for real implementations (run `effect-solutions setup` first)

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

<!-- effect-solutions:end -->

Unless I explicitly state otherwise, the request relates to this codebase. i.e "add the deepwiki MCP to the default sources" means look through the codebase for how thats relevant, not update opencode config
