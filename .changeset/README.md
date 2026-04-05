# Changesets

This repo uses Changesets to drive releases for the published `executor` CLI.

## What to put in a changeset

Only `executor` is managed directly by Changesets.

After `changeset version` runs, `scripts/release/sync-versions.mjs` copies that version to the rest of the repo manifests so the workspace stays aligned without making every internal package independently releasable.

## Beta releases

Use prerelease mode for beta trains:

- `bun run release:beta:start`
- merge release PRs while prerelease mode is active
- `bun run release:beta:stop` when you want to return to stable releases
