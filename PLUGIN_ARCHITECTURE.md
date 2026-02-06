# OpenAssistant Plugin Architecture

## Status: Planning Draft

## Problem Statement

Today, tools are hardcoded in `apps/discord-bot/src/tools.ts`. The `defineTool()` API exists in `@openassistant/core` and works well, but there is no way for users to:

1. Define their own tools outside the monorepo source.
2. Install third-party tool packages.
3. Discover tools from a workspace/config directory.
4. Get type declarations auto-generated for the codemode typechecker.

We need a plugin system that makes tools **installable, discoverable, and configurable** while keeping the core primitives (receipts, approval, sandboxed execution) intact.

---

## Design Principles

1. **Config-file-driven.** One config file is the source of truth for what's loaded.
2. **No runtime magic.** Discovery is explicit scan, not auto-import. No decorators, no file-convention routing.
3. **Tools are the plugin unit.** MVP plugins = tool packages. Hooks, channels, services come later.
4. **TypeScript-native.** Plugins are authored in TypeScript, loaded via `jiti` (or Bun's native loader). No build step required for plugin authors.
5. **Monorepo-friendly.** Works whether your plugin is a workspace package, a path on disk, or an npm install.
6. **Minimal surface.** Plugin API is `defineTool()` + a manifest. That's it for MVP.

---

## What Is a Plugin?

A plugin is a directory (or npm package) containing:

```
my-plugin/
  package.json          # Must have "openassistant" key
  openassistant.json    # Plugin manifest (metadata, config schema)
  index.ts              # Entry point, default exports a ToolTree or register function
```

### `package.json` (minimal)

```json
{
  "name": "@myorg/oa-posthog",
  "type": "module",
  "dependencies": {
    "posthog-node": "^4.0.0"
  },
  "peerDependencies": {
    "@openassistant/sdk": "*"
  },
  "openassistant": {
    "entry": "./index.ts"
  }
}
```

The `"openassistant"` key is the marker. It tells the loader this is a plugin, and where to find the entry point.

- `entry` defaults to `./index.ts` (then `./index.js`, `./src/index.ts`).
- Plugin-specific dependencies go in `dependencies`. `@openassistant/sdk` is a `peerDependency` (the host provides it at load time).

### `openassistant.json` (plugin manifest)

```json
{
  "id": "posthog",
  "name": "PostHog Analytics",
  "description": "Read analytics and create monitors via PostHog API.",
  "version": "0.1.0",
  "configSchema": {
    "type": "object",
    "required": ["apiKey", "projectId"],
    "properties": {
      "apiKey": { "type": "string" },
      "projectId": { "type": "string" },
      "host": { "type": "string", "default": "https://us.posthog.com" }
    },
    "additionalProperties": false
  }
}
```

- `id` is the unique namespace. Tool paths become `posthog.analytics.getVisitors` etc.
- `configSchema` is JSON Schema. Validated at load time against the user's config.
- If no `openassistant.json` exists, the loader reads `id` from `package.json` name (strip scope) and config schema is treated as empty (no config required).

### Entry Module

Two supported patterns:

**Pattern A: Export a ToolTree directly (simple case)**

```ts
import { defineTool } from "@openassistant/sdk";
import { Effect } from "effect";

export default {
  analytics: {
    getVisitors: defineTool({
      id: "posthog.analytics.getVisitors",
      kind: "read",
      approval: "auto",
      run: (input: { projectId: string }) =>
        Effect.tryPromise(() => fetch(`...`).then(r => r.json())),
    }),
  },
} satisfies ToolTree;
```

**Pattern B: Export a register function (needs config/context)**

```ts
import { defineTool, type PluginContext, type ToolTree } from "@openassistant/sdk";
import { Effect } from "effect";

export default function register(ctx: PluginContext): ToolTree {
  const client = new PostHogClient(ctx.config.apiKey, ctx.config.host);

  return {
    analytics: {
      getVisitors: defineTool({
        kind: "read",
        approval: "auto",
        run: (input: { website: string }) =>
          Effect.tryPromise(() => client.getInsight(input.website)),
      }),
    },
    monitor: {
      createThreshold: defineTool({
        kind: "write",
        approval: "required",
        run: (input: { website: string; threshold: number }) =>
          Effect.tryPromise(() => client.createAlert(input)),
      }),
    },
  };
}
```

`PluginContext` provides:
- `config`: validated plugin config from the user's config file.
- `logger`: scoped logger.
- `dataDir`: per-plugin persistent data directory (`~/.config/openassistant/data/<pluginId>/`).

---

## Config File

Location: `~/.config/openassistant/config.json` (or `OPENASSISTANT_CONFIG_PATH` env var).

For monorepo users: `.openassistant/config.json` in the project root (detected by walking up from cwd).

Resolution order:
1. Project-local: `<project>/.openassistant/config.json`
2. Global: `~/.config/openassistant/config.json`
3. Merged (project overrides global).

```json
{
  "plugins": {
    "paths": [
      "./tools/posthog",
      "./tools/github",
      "/absolute/path/to/custom-plugin"
    ],
    "npm": [
      "@openassistant/plugin-github",
      "@openassistant/plugin-posthog@^0.2.0"
    ],
    "config": {
      "posthog": {
        "enabled": true,
        "apiKey": "${POSTHOG_API_KEY}",
        "projectId": "12345",
        "host": "https://us.posthog.com"
      },
      "github": {
        "enabled": true,
        "token": "${GITHUB_TOKEN}"
      }
    }
  },
  "auth": {
    "anthropic": {
      "type": "token",
      "profileOrder": ["manual", "env"]
    }
  }
}
```

### Plugin Sources (Discovery Origins)

Plugins are discovered from these origins, in priority order:

| Origin | Location | Use Case |
|--------|----------|----------|
| `config.plugins.paths` | Explicit paths from config | Monorepo workspace tools, local dev |
| `workspace` | `<project>/.openassistant/plugins/` | Project-scoped plugins dropped into a convention dir |
| `global` | `~/.config/openassistant/plugins/` | User-global plugins (installed via CLI) |
| `npm` | `config.plugins.npm` entries resolved from `node_modules` | npm-installed plugins |
| `bundled` | `<openassistant-package>/plugins/` | Shipped with the core package |

### Plugin Config

Config values support `${ENV_VAR}` interpolation so secrets don't live in config files.

Per-plugin config is validated against the plugin's `configSchema` at load time. If validation fails, the plugin is skipped with a warning (not a crash).

`enabled: false` in a plugin's config block disables it without removing its config.

---

## Discovery and Loading Pipeline

```
1. RESOLVE CONFIG
   - Find config file (project-local, then global)
   - Parse and merge

2. DISCOVER PLUGINS
   - Scan each origin (paths, workspace, global, npm, bundled)
   - For each candidate directory:
     a. Read package.json, check for "openassistant" key
     b. Read openassistant.json (or derive defaults from package.json)
     c. Deduplicate by plugin ID (first origin wins)

3. FILTER
   - Check enabled/disabled state from config
   - Skip plugins with missing required config

4. VALIDATE CONFIG
   - Run JSON Schema validation on each plugin's config block
   - Log warnings for invalid configs, skip those plugins

5. LOAD MODULE
   - Use jiti (or Bun native import) to load the TypeScript entry point
   - Alias "@openassistant/sdk" to the host's SDK module

6. RESOLVE EXPORT
   - If default export is a function: call it with PluginContext -> get ToolTree
   - If default export is a ToolTree: use directly
   - Namespace the tree under the plugin ID

7. MERGE TOOL TREES
   - Combine all plugin ToolTrees into the master ToolTree
   - Detect ID collisions (error)

8. GENERATE TYPE DECLARATIONS
   - Walk the merged ToolTree
   - Emit TypeScript ambient declarations for the codemode typechecker
   - This replaces the hardcoded TOOL_DECLARATIONS string

9. READY
   - Pass merged ToolTree to createCodeModeRunner()
   - Plugin tools are now available in the sandbox
```

---

## The SDK Package (`@openassistant/sdk`)

New package: `packages/sdk/`. This is the public API surface for plugin authors.

Exports:
- `defineTool()` (re-exported from core)
- `ToolTree`, `ToolDefinition`, `ToolKind`, `ToolApprovalMode` types
- `PluginContext` type
- `z` (re-export zod for schema definitions)
- `Effect` (re-export for handler authoring)

```ts
// packages/sdk/src/index.ts
export { defineTool, type ToolTree, type ToolDefinition, type ToolKind, type ToolApprovalMode } from "@openassistant/core";
export type { PluginContext } from "./plugin-context.js";
export { z } from "zod";
export { Effect } from "effect";
```

Plugin authors install `@openassistant/sdk` as a `peerDependency`. The host resolves it via aliasing at load time (same pattern as OpenClaw's jiti alias for `openclaw/plugin-sdk`).

---

## Type Declaration Generation

The current `code-typecheck.ts` has a hardcoded `TOOL_DECLARATIONS` string. This needs to be generated dynamically from the merged ToolTree.

Approach:
- After loading all plugins and merging the ToolTree, walk the tree.
- For each `ToolDefinition`, inspect the `run` function's parameter type (via the zod schema on the definition, which we add in the next iteration).
- Generate ambient declarations: `declare const tools: { calendar: { update(input: { title: string; startsAt: string; notes?: string }): Promise<unknown>; }; };`
- Pass this to the typechecker instead of the hardcoded string.

**MVP shortcut**: For MVP, require plugins to export a `declarations` string alongside their ToolTree. Long-term, derive from schemas.

```ts
// Plugin can optionally export declarations
export const declarations = `{
  analytics: {
    getVisitors(input: { projectId: string; website: string }): Promise<unknown>;
  };
  monitor: {
    createThreshold(input: { website: string; threshold: number }): Promise<unknown>;
  };
}`;
```

The loader concatenates all plugin declaration fragments into a single `declare const tools: { ... }` block.

---

## Monorepo User Experience

### Scenario: User has a Bun monorepo

```
my-project/
  .openassistant/
    config.json
    plugins/                    # Convention dir for local plugins
      posthog/
        package.json
        openassistant.json
        index.ts
  apps/
    my-app/
  packages/
    my-lib/
```

`.openassistant/config.json`:
```json
{
  "plugins": {
    "config": {
      "posthog": {
        "apiKey": "${POSTHOG_API_KEY}",
        "projectId": "12345"
      }
    }
  }
}
```

That's it. The convention directory is auto-scanned. Config is in one place.

### Scenario: User has tools as a workspace package

```
my-project/
  .openassistant/
    config.json
  packages/
    oa-tools/                   # Workspace package with tools
      package.json              # has "openassistant" key
      openassistant.json
      src/
        index.ts
```

`.openassistant/config.json`:
```json
{
  "plugins": {
    "paths": ["./packages/oa-tools"]
  }
}
```

Explicit path reference. Clean, no magic.

### Scenario: User installs from npm

```bash
bun add @openassistant/plugin-github
```

`.openassistant/config.json`:
```json
{
  "plugins": {
    "npm": ["@openassistant/plugin-github"],
    "config": {
      "github": {
        "token": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

The loader resolves `@openassistant/plugin-github` from `node_modules`.

---

## CLI Surface (Future)

```bash
# Initialize config in current project
openassistant init

# List discovered plugins and their status
openassistant plugins list

# Validate plugin configs
openassistant plugins check

# Install a plugin from npm to global plugins dir
openassistant plugins install @openassistant/plugin-github

# Scaffold a new plugin
openassistant plugins create my-plugin
```

Not needed for MVP. The config file + discovery is enough.

---

## Implementation Plan

### Phase 1: Config + Discovery (Foundation)

1. **Config loader** (`packages/core/src/config/`)
   - Find config file (project-local walk-up, global fallback)
   - Parse JSON with `${ENV_VAR}` interpolation
   - Type-safe config shape with validation
   - Export `resolveConfig(): OpenAssistantConfig`

2. **Plugin discovery** (`packages/core/src/plugins/discovery.ts`)
   - Scan each origin (paths, workspace dir, global dir)
   - Read `package.json` "openassistant" key
   - Read `openassistant.json` manifest
   - Return `DiscoveredPlugin[]` with id, path, manifest, origin

3. **Plugin loader** (`packages/core/src/plugins/loader.ts`)
   - Load TypeScript entry via `jiti` or dynamic `import()`
   - Resolve export pattern (function vs ToolTree)
   - Validate plugin config against schema
   - Return `LoadedPlugin { id, toolTree, declarations? }`

4. **Plugin registry** (`packages/core/src/plugins/registry.ts`)
   - Merge all loaded plugin ToolTrees into master tree
   - Namespace under plugin IDs
   - Detect collisions
   - Export `createPluginRegistry(config): { toolTree: ToolTree, declarations: string }`

### Phase 2: SDK Package

5. **Create `packages/sdk/`**
   - Barrel export of `defineTool`, types, `PluginContext`, `z`, `Effect`
   - `package.json` with proper `exports` map
   - Will eventually be publishable to npm (remove `private: true`)

### Phase 3: Wire Into Runtime

6. **Update `apps/discord-bot/`**
   - Replace hardcoded `createToolTree()` with `createPluginRegistry(config).toolTree`
   - Replace hardcoded `TOOL_DECLARATIONS` with generated declarations
   - Config-driven tool loading

7. **Update `apps/gateway/`**
   - Same plugin registry integration

### Phase 4: Developer Experience

8. **`openassistant init` command** (scaffold `.openassistant/config.json`)
9. **`openassistant plugins create` command** (scaffold plugin directory)
10. **Documentation** for plugin authors

---

## Key Decisions to Make

### 1. Module Loading Strategy

**Option A: jiti** (like OpenClaw)
- Pros: Battle-tested, works in Node and Bun, handles TypeScript natively.
- Cons: Another dependency, may have edge cases with Effect imports.

**Option B: Bun native `import()`**
- Pros: Zero deps, Bun handles TypeScript natively, fast.
- Cons: Only works in Bun runtime, may need `file://` URL construction, plugin resolution is less configurable.

**Option C: Bun `import()` with fallback to jiti for Node compat**
- Pros: Best of both. Fast path for Bun, fallback for portability.

**Recommendation: Option B for MVP (Bun-only).** We're already Bun-native. Use dynamic `import()` with path resolution. Add jiti as a fallback later if Node support matters.

### 2. Where Does Config Live?

**Recommendation:** 
- Project-local: `.openassistant/config.json` (detected by walking up from cwd looking for `.openassistant/` or `package.json` with `"openassistant"` key).
- Global: `~/.config/openassistant/config.json`.
- Merge strategy: project-local overrides global (deep merge for `plugins.config`).

### 3. Plugin ID Namespacing

**Option A:** Plugin tools are auto-namespaced: `tools.<pluginId>.<toolName>`.
**Option B:** Plugin chooses its own namespace via manifest `id`.
**Option C:** Flat merge, plugin responsible for unique paths.

**Recommendation: Option B.** The manifest `id` is the namespace. `tools.posthog.analytics.getVisitors`. The `id` is the top-level key in the merged tree.

### 4. Schema on Tool Definitions

Currently `defineTool()` doesn't take an input schema -- the `run` function signature is the contract. For type declaration generation, we need schemas.

**Recommendation:** Add optional `input` schema (zod) to `defineTool()`. Not required for MVP (use exported `declarations` string as bridge), but strongly encouraged.

```ts
defineTool({
  kind: "read",
  approval: "auto",
  input: z.object({ projectId: z.string() }),  // NEW
  run: (input) => Effect.tryPromise(() => ...),
})
```

### 5. Hot Reload

**MVP: No.** Restart to pick up plugin changes. Gateway already supports `--hot` via Bun, which covers dev workflow. True hot-reload of plugin registry is Phase 2+.

---

## Security Considerations

1. **Plugins run in the same process.** No sandbox between plugins and the gateway. This is intentional for MVP -- the sandbox is between the LLM-generated code and the tool implementations, not between plugins.

2. **Config interpolation** only supports `${ENV_VAR}` syntax. No shell expansion, no nested interpolation, no code execution.

3. **Plugin code is trusted.** If a user puts a plugin in their config, they trust it. We don't scan for malicious code (unlike OpenClaw's warning-only scan).

4. **Secrets in config** should use env var interpolation. We should warn (not block) if literal API keys appear in config files.

---

## File Layout After Implementation

```
packages/
  core/
    src/
      index.ts
      codemode/
        runner.ts               # Existing, unchanged
      config/
        loader.ts               # NEW: config file resolution + parsing
        types.ts                # NEW: config schema types
        interpolation.ts        # NEW: ${ENV_VAR} expansion
      plugins/
        discovery.ts            # NEW: scan origins for plugin candidates
        loader.ts               # NEW: load plugin TypeScript modules
        manifest.ts             # NEW: parse/validate openassistant.json
        registry.ts             # NEW: merge ToolTrees, generate declarations
        types.ts                # NEW: DiscoveredPlugin, LoadedPlugin, etc.
  sdk/
    package.json                # NEW: @openassistant/sdk
    src/
      index.ts                  # NEW: public API barrel
      plugin-context.ts         # NEW: PluginContext type
```

---

## Open Questions

1. **Should the SDK be a separate package or an export path from core?**
   Leaning separate package (`packages/sdk/`) for clean dependency boundary. Plugin authors only need the SDK, not core internals.

2. **How do we handle plugin dependencies at install time?**
   For workspace/path plugins: they manage their own deps. For npm plugins: deps come with the package. For global install: we may need `bun install` in the plugin dir (like OpenClaw does `npm install --omit=dev`).

3. **Do we need a plugin lockfile?**
   Probably not for MVP. Config file is declarative. `bun.lock` in the host project handles npm-sourced plugins.

4. **Should plugins be able to register things other than tools?**
   Not for MVP. But the `register(ctx)` function pattern leaves the door open for `ctx.registerHook()`, `ctx.registerCommand()`, etc. later.
