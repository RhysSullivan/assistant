/**
 * Builds the executor CLI binary and copies it into the desktop app's
 * resources/ folder so electron-builder can bundle it as a sidecar.
 */
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, cpSync, chmodSync } = require("node:fs");
const { resolve, join } = require("node:path");

const root = resolve(__dirname, "..");
const repoRoot = resolve(root, "../..");
const cliRoot = resolve(repoRoot, "apps/cli");
const resourcesDir = resolve(root, "resources");

// Build CLI for current platform
console.log("Building executor CLI binary...");

// Resolve bun binary path explicitly
const { homedir } = require("node:os");
const bunBin = resolve(process.env.BUN_INSTALL || join(homedir(), ".bun"), "bin", "bun");

const result = spawnSync(bunBin, ["run", "src/build.ts", "binary", "--single"], {
  cwd: cliRoot,
  stdio: "inherit",
});

if (result.error) {
  console.error("CLI build spawn error:", result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`CLI build failed with exit code ${result.status}`);
  process.exit(1);
}

// Find the built binary
const platform = process.platform === "win32" ? "windows" : process.platform;
const arch = process.arch === "arm64" ? "arm64" : "x64";
const binaryName = process.platform === "win32" ? "executor.exe" : "executor";
const targetDir = join(cliRoot, "dist", `executor-${platform}-${arch}`, "bin");

if (!existsSync(join(targetDir, binaryName))) {
  console.error(`Binary not found at ${join(targetDir, binaryName)}`);
  process.exit(1);
}

// Copy to resources/
mkdirSync(resourcesDir, { recursive: true });
cpSync(join(targetDir, binaryName), join(resourcesDir, binaryName));
chmodSync(join(resourcesDir, binaryName), 0o755);

// Copy QuickJS WASM if present
const wasmPath = join(targetDir, "emscripten-module.wasm");
if (existsSync(wasmPath)) {
  cpSync(wasmPath, join(resourcesDir, "emscripten-module.wasm"));
}

console.log(`Sidecar binary copied to ${resourcesDir}`);
