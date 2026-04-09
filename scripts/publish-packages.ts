#!/usr/bin/env bun
/**
 * Publishes the public @executor-js/* workspace packages to npm.
 *
 * Walks a hard-coded list of publishable package directories, determines the
 * dist-tag from the version string (anything containing `-` is treated as beta),
 * and packs + publishes each package whose current version is not already on npm.
 *
 * Invoked from `.github/workflows/release.yml` via the `publish:` input on
 * changesets/action after the Version Packages PR has been merged, and locally
 * via `bun run release:publish:packages` (or `--dry-run`).
 */
import { $ } from "bun";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Channel = "latest" | "beta";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Workspace-relative paths of the public packages. Kept explicit so a new
 * directory under `packages/plugins/` does not accidentally ship to npm.
 */
const PUBLIC_PACKAGE_DIRS = [
  "packages/core/core",
  "packages/published/sdk",
  "packages/plugins/file-secrets",
  "packages/plugins/google-discovery",
  "packages/plugins/graphql",
  "packages/plugins/keychain",
  "packages/plugins/mcp",
  "packages/plugins/onepassword",
  "packages/plugins/openapi",
] as const;

const parseArgs = (argv: ReadonlyArray<string>): { dryRun: boolean } => {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { dryRun };
};

const resolveChannel = (version: string): Channel =>
  version.includes("-") ? "beta" : "latest";

const readPackageMeta = async (pkgDir: string) => {
  const pkgJsonPath = join(pkgDir, "package.json");
  const pkg = await Bun.file(pkgJsonPath).json() as {
    name?: string;
    version?: string;
    private?: boolean;
  };

  if (!pkg.name || !pkg.version) {
    throw new Error(`Missing name/version in ${pkgJsonPath}`);
  }
  if (pkg.private === true) {
    throw new Error(`${pkg.name} is marked private and cannot be published`);
  }

  return { name: pkg.name, version: pkg.version };
};

const packageAlreadyPublished = async (name: string, version: string): Promise<boolean> => {
  const proc = Bun.spawn(["npm", "view", `${name}@${version}`, "version"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return (await proc.exited) === 0;
};

const publishPackage = async (pkgDir: string, channel: Channel, dryRun: boolean) => {
  const { name, version } = await readPackageMeta(pkgDir);

  if (!existsSync(join(pkgDir, "dist"))) {
    throw new Error(`Missing dist/ in ${pkgDir}. Did you run 'bun run build:packages'?`);
  }

  if (await packageAlreadyPublished(name, version)) {
    console.log(`[skip] ${name}@${version} already on npm`);
    return;
  }

  console.log(`[publish] ${name}@${version} (${channel})${dryRun ? " [dry-run]" : ""}`);

  await $`bun pm pack`.cwd(pkgDir);

  if (dryRun) {
    return;
  }

  const args = ["publish", "*.tgz", "--access", "public", "--tag", channel];
  if (process.env.GITHUB_ACTIONS === "true") {
    args.push("--provenance");
  }
  await $`npm ${args}`.cwd(pkgDir);
};

const main = async () => {
  const { dryRun } = parseArgs(process.argv.slice(2));

  // Use the @executor-js/sdk version as the source of truth for the channel.
  // All @executor-js packages version together (they're not in the changeset
  // ignore list), so they share a release channel.
  const sdkMeta = await readPackageMeta(join(repoRoot, "packages/published/sdk"));
  const channel = resolveChannel(sdkMeta.version);
  console.log(`Publishing @executor-js packages (${channel})${dryRun ? " [dry-run]" : ""}`);

  await $`bun run build:packages`.cwd(repoRoot);

  for (const relDir of PUBLIC_PACKAGE_DIRS) {
    await publishPackage(join(repoRoot, relDir), channel, dryRun);
  }
};

await main();
