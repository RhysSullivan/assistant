# Oxlint Custom Rules

This directory contains repo-local Oxlint JS plugin rules for the workspace.

Why it lives here:

- The root `.oxlintrc.jsonc` runs Oxlint once across the whole monorepo.
- Custom rules here apply to every workspace under `apps/*` and `packages/*/*`.
- The setup uses JSONC config on purpose so it works consistently in this Bun repo without relying on Oxlint's experimental TypeScript config loader.

Current rules:

- `executor-monorepo/no-async-effect-vitest-tests`
- `executor-monorepo/no-cross-workspace-relative-imports`
- `executor-monorepo/no-direct-effect-tag-read`
- `executor-monorepo/no-effect-run-in-effect-vitest-tests`
- `executor-monorepo/no-manual-httpapi-openapi-bridge`
- `executor-monorepo/no-manual-openapi-documents`
- `executor-monorepo/no-node-fs-with-effect-imports`
- `executor-monorepo/no-raw-effect-fail-errors`
- `executor-monorepo/no-yield-effect-fail`
- `executor-monorepo/no-workspace-src-imports`

To add another rule:

1. Create `tools/oxlint/rules/<rule-name>.mjs`.
2. Export it from `tools/oxlint/plugin.mjs`.
3. Enable it in `.oxlintrc.jsonc`.
