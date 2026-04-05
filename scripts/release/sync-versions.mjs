import { readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePackagePath = join(repoRoot, "apps/cli/package.json");
const skippedPackageNames = new Set([
  "@executor/runtime-deno-subprocess",
]);

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const writeJson = async (path, value) => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
};

const collectPackageJsonPaths = async () => {
  const paths = [join(repoRoot, "package.json")];

  for (const entry of await readdir(join(repoRoot, "apps"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(repoRoot, "apps", entry.name, "package.json");
    if (existsSync(candidate)) {
      paths.push(candidate);
    }
  }

  const packagesUi = join(repoRoot, "packages/ui/package.json");
  if (existsSync(packagesUi)) {
    paths.push(packagesUi);
  }

  for (const group of await readdir(join(repoRoot, "packages"), { withFileTypes: true })) {
    if (!group.isDirectory() || group.name === "ui") continue;
    const groupDir = join(repoRoot, "packages", group.name);

    for (const entry of await readdir(groupDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(groupDir, entry.name, "package.json");
      if (existsSync(candidate)) {
        paths.push(candidate);
      }
    }
  }

  return paths;
};

const main = async () => {
  const sourcePackage = await readJson(sourcePackagePath);
  const version = sourcePackage.version;

  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`Missing version in ${sourcePackagePath}`);
  }

  const packageJsonPaths = await collectPackageJsonPaths();
  const updated = [];

  for (const path of packageJsonPaths) {
    if (path === sourcePackagePath) continue;

    const pkg = await readJson(path);
    if (typeof pkg.version !== "string") continue;
    if (skippedPackageNames.has(pkg.name)) continue;
    if (pkg.version === version) continue;

    pkg.version = version;
    await writeJson(path, pkg);
    updated.push(path);
  }

  if (updated.length === 0) {
    console.log(`All package versions already match ${version}.`);
    return;
  }

  console.log(`Synced ${updated.length} package version(s) to ${version}:`);
  for (const path of updated) {
    console.log(`- ${path.replace(`${repoRoot}/`, "")}`);
  }
};

await main();
