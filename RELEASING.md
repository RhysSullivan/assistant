# Releasing

This repo uses Changesets for version orchestration and two publish paths:
the CLI (`executor` npm package plus its platform packages) and the
`@executor-js/*` library packages (`core`, `sdk`, and the public plugins).

## Normal release flow

1. Add a changeset in the PR that should ship:
   - `bun run changeset`
2. Merge that PR to `main`.
3. `.github/workflows/release.yml` opens or updates a `Version Packages` PR.
4. Merge the `Version Packages` PR.
5. The release workflow then does two things in parallel:
   - Publishes every `@executor-js/*` library package whose current version
     is not already on npm, via `bun run release:publish:packages`
     (see `scripts/publish-packages.ts`).
   - If `apps/cli/package.json` bumped, tags the commit and dispatches
     `.github/workflows/publish-executor-package.yml`, which:
     - runs `bun run release:check`
     - performs a full dry-run release build before publish
     - publishes the CLI npm package under the correct dist-tag
     - creates or updates the GitHub release with build artifacts

## Beta releases

Enter prerelease mode before starting a beta train:

- `bun run release:beta:start`

That commits `.changeset/pre.json` into the repo and causes future release PRs to produce versions like `1.5.0-beta.0`, `1.5.0-beta.1`, and so on.

When the beta train is done:

- `bun run release:beta:stop`

Stable versions publish to npm under `latest`.
Beta versions publish to npm under `beta`.

## Local dry run

To build the full CLI release payload without publishing to npm or GitHub:

- `bun run release:publish:dry-run`

That produces:

- platform archives in `apps/cli/dist`
- the packed wrapper tarball in `apps/cli/dist/release`

To pack the `@executor-js/*` library packages without publishing:

- `bun run release:publish:packages:dry-run`

## Notes

- Changesets owns the published CLI version via `apps/cli/package.json`.
- Only `apps/cli/package.json` should change during release versioning; the rest of the workspace is not version-synced for release PRs.
- Changesets changelog file generation is disabled; GitHub release notes are generated at publish time instead.
- Workspace `CHANGELOG.md` files are kept as compatibility files for the Changesets GitHub Action release PR flow.
- The publish workflow supports either npm trusted publishing or an `NPM_TOKEN` secret.
- Re-running the publish workflow for the same tag is safe for packages that are already on npm; existing versions are skipped.
