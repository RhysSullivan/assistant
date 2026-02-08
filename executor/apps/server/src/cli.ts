/**
 * Executor CLI — starts the local Convex backend, pushes functions, and launches the executor server.
 *
 * Usage:
 *   bun executor/apps/server/src/cli.ts start [--port 4001] [--convex-port 3210]
 *   bun executor/apps/server/src/cli.ts start --auto-execute
 *
 * The CLI manages 3 concerns:
 *   1. convex-local-backend binary (download if missing, launch, wait for ready)
 *   2. Convex function push (bundle + deploy schema/functions via `convex dev --once`)
 *   3. Executor server (the Elysia HTTP + MCP server)
 */

import { existsSync } from "node:fs";
import { mkdir, chmod, readdir, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir, platform, arch } from "node:os";

// ── Config ──

const CONVEX_REPO = "get-convex/convex-backend";
const GITHUB_RELEASES_API = `https://api.github.com/repos/${CONVEX_REPO}/releases`;

interface CliOptions {
  port: number;
  convexPort: number;
  convexSitePort: number;
  autoExecute: boolean;
  dataDir: string;
}

function parseArgs(args: string[]): { command: string; options: CliOptions } {
  const command = args[0] ?? "start";
  const options: CliOptions = {
    port: 4001,
    convexPort: 3210,
    convexSitePort: 3211,
    autoExecute: false,
    dataDir: join(homedir(), ".executor"),
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--port":
        options.port = Number(args[++i]);
        break;
      case "--convex-port":
        options.convexPort = Number(args[++i]);
        break;
      case "--auto-execute":
        options.autoExecute = true;
        break;
      case "--data-dir":
        options.dataDir = args[++i];
        break;
    }
  }

  return { command, options };
}

// ── Logging ──

const colors = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

function log(msg: string) {
  console.log(`${colors.cyan}[executor]${colors.reset} ${msg}`);
}

function logStep(step: string) {
  console.log(`\n${colors.bold}${colors.green}▸${colors.reset} ${step}`);
}

function logError(msg: string) {
  console.error(`${colors.red}[executor]${colors.reset} ${msg}`);
}

// ── Platform detection ──

function getArtifactName(): string {
  const p = platform();
  const a = arch();

  const map: Record<string, Record<string, string>> = {
    darwin: {
      arm64: "convex-local-backend-aarch64-apple-darwin.zip",
      x64: "convex-local-backend-x86_64-apple-darwin.zip",
    },
    linux: {
      arm64: "convex-local-backend-aarch64-unknown-linux-gnu.zip",
      x64: "convex-local-backend-x86_64-unknown-linux-gnu.zip",
    },
    win32: {
      x64: "convex-local-backend-x86_64-pc-windows-msvc.zip",
    },
  };

  const artifact = map[p]?.[a];
  if (!artifact) {
    throw new Error(`Unsupported platform: ${p}/${a}`);
  }
  return artifact;
}

function getBinaryName(): string {
  return platform() === "win32" ? "convex-local-backend.exe" : "convex-local-backend";
}

// ── Binary management ──

function getBinariesDir(): string {
  return join(homedir(), ".cache", "convex", "binaries");
}

async function findLatestVersion(artifactName: string): Promise<string> {
  log("Checking for latest convex-local-backend release...");

  let url: string | null = `${GITHUB_RELEASES_API}?per_page=30`;

  while (url) {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "executor-cli",
      },
    });

    if (!resp.ok) {
      throw new Error(`GitHub API returned ${resp.status}: ${await resp.text()}`);
    }

    const releases = (await resp.json()) as Array<{
      tag_name: string;
      prerelease: boolean;
      draft: boolean;
      assets: Array<{ name: string }>;
    }>;

    for (const release of releases) {
      if (release.prerelease || release.draft) continue;
      if (release.assets.some((a) => a.name === artifactName)) {
        return release.tag_name;
      }
    }

    // Follow pagination
    const link = resp.headers.get("link");
    const next = link?.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }

  throw new Error("No convex-local-backend release found for this platform");
}

async function ensureBinary(): Promise<string> {
  const artifactName = getArtifactName();
  const binaryName = getBinaryName();
  const binDir = getBinariesDir();

  // Check if any version is already cached
  if (existsSync(binDir)) {
    const entries = await readdir(binDir);
    for (const entry of entries) {
      const binaryPath = join(binDir, entry, binaryName);
      if (existsSync(binaryPath)) {
        log(`Using cached binary: ${binaryPath}`);
        return binaryPath;
      }
    }
  }

  // Download latest
  const version = await findLatestVersion(artifactName);
  const versionDir = join(binDir, version);
  const binaryPath = join(versionDir, binaryName);

  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  log(`Downloading convex-local-backend ${version}...`);
  const downloadUrl = `https://github.com/${CONVEX_REPO}/releases/download/${version}/${artifactName}`;

  const resp = await fetch(downloadUrl, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  }

  // Extract zip
  const zipBuffer = await resp.arrayBuffer();
  const tmpDir = join(binDir, `_tmp_${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const tmpZip = join(tmpDir, "download.zip");
  await Bun.write(tmpZip, zipBuffer);

  // Use unzip to extract
  const unzip = Bun.spawn(["unzip", "-o", tmpZip, "-d", tmpDir], {
    stdout: "ignore",
    stderr: "pipe",
  });
  await unzip.exited;

  // Find the binary in extracted files
  const extracted = await readdir(tmpDir);
  const foundBinary = extracted.find((f) => f === binaryName || f === "convex-local-backend");
  if (!foundBinary) {
    throw new Error(`Binary not found in zip. Contents: ${extracted.join(", ")}`);
  }

  await mkdir(versionDir, { recursive: true });
  await rename(join(tmpDir, foundBinary), binaryPath);
  await chmod(binaryPath, 0o755);

  // Cleanup
  await rm(tmpDir, { recursive: true, force: true });

  log(`Downloaded to ${binaryPath}`);
  return binaryPath;
}

// ── Convex backend lifecycle ──

interface BackendInfo {
  proc: Bun.Subprocess;
  url: string;
  adminKey: string;
  instanceName: string;
}

async function waitForBackend(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`${url}/instance_name`);
      if (resp.ok) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`Convex backend did not become ready within ${timeoutMs}ms`);
}

async function readBackendConfig(
  instanceName: string,
): Promise<{ adminKey: string; ports: { cloud: number; site: number } }> {
  // Check both project-linked and anonymous state dirs
  const stateBaseDirs = [
    join(homedir(), ".convex", "convex-backend-state"),
    join(homedir(), ".convex", "anonymous-convex-backend-state"),
  ];

  for (const baseDir of stateBaseDirs) {
    const configPath = join(baseDir, instanceName, "config.json");
    if (existsSync(configPath)) {
      const config = await Bun.file(configPath).json();
      return config;
    }
  }

  throw new Error(
    `Could not find backend config for instance '${instanceName}'. Checked: ${stateBaseDirs.map((d) => join(d, instanceName)).join(", ")}`,
  );
}

async function startBackend(binaryPath: string, port: number): Promise<BackendInfo> {
  logStep("Starting Convex local backend...");

  // Check if already running
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/instance_name`);
    if (resp.ok) {
      const instanceName = await resp.text();
      log(`Backend already running: ${instanceName}`);
      const config = await readBackendConfig(instanceName);
      return {
        proc: null as any, // Not our process
        url: `http://127.0.0.1:${port}`,
        adminKey: config.adminKey,
        instanceName,
      };
    }
  } catch {
    // Not running, start it
  }

  const proc = Bun.spawn([binaryPath, "--port", String(port)], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env },
  });

  // Stream backend output with prefix
  const streamLines = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          console.log(`${colors.dim}[convex]${colors.reset} ${line}`);
        }
      }
    }
  };

  streamLines(proc.stdout);
  streamLines(proc.stderr);

  log(`Waiting for backend on port ${port}...`);
  await waitForBackend(`http://127.0.0.1:${port}`);

  const resp = await fetch(`http://127.0.0.1:${port}/instance_name`);
  const instanceName = await resp.text();
  log(`Backend ready: ${instanceName}`);

  const config = await readBackendConfig(instanceName);

  return {
    proc,
    url: `http://127.0.0.1:${port}`,
    adminKey: config.adminKey,
    instanceName,
  };
}

// ── Push functions ──

async function pushFunctions(backendUrl: string, adminKey: string): Promise<void> {
  logStep("Pushing Convex functions...");

  const convexDir = resolve(import.meta.dir, "../../../");
  log(`Convex project dir: ${convexDir}`);

  // Write a temp env file so `convex dev --once` doesn't touch .env.local.
  // Using --env-file with CONVEX_SELF_HOSTED_URL/ADMIN_KEY bypasses all
  // local backend management and avoids the "already running" error.
  const tmpEnvFile = join(convexDir, ".env.executor-push");
  await Bun.write(
    tmpEnvFile,
    [
      `CONVEX_SELF_HOSTED_URL=${backendUrl}`,
      `CONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}`,
    ].join("\n"),
  );

  try {
    // Strip CONVEX_DEPLOYMENT from env to avoid conflicts — the env file provides the target.
    const cleanEnv = { ...Bun.env };
    delete cleanEnv.CONVEX_DEPLOYMENT;

    const proc = Bun.spawn(
      [
        "bunx",
        "convex",
        "dev",
        "--once",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        "--env-file",
        tmpEnvFile,
      ],
      {
        cwd: convexDir,
        stdout: "pipe",
        stderr: "pipe",
        env: cleanEnv,
      },
    );

    const stdout = await Bun.readableStreamToText(proc.stdout);
    const stderr = await Bun.readableStreamToText(proc.stderr);
    const exitCode = await proc.exited;

    if (stdout.trim()) log(stdout.trim());
    if (stderr.trim() && exitCode !== 0) logError(stderr.trim());

    if (exitCode !== 0) {
      throw new Error(`Function push failed with exit code ${exitCode}`);
    }

    log("Functions pushed successfully");
  } finally {
    // Clean up temp env file
    try {
      await rm(tmpEnvFile, { force: true });
    } catch {}
  }
}

// ── Executor server ──

async function startServer(options: CliOptions, backendUrl: string): Promise<Bun.Subprocess> {
  logStep("Starting executor server...");

  const serverEntry = resolve(import.meta.dir, "index.ts");

  const proc = Bun.spawn(["bun", "--hot", serverEntry], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      PORT: String(options.port),
      CONVEX_URL: backendUrl,
      EXECUTOR_SERVER_AUTO_EXECUTE: options.autoExecute ? "1" : "0",
    },
  });

  const streamLines = async (stream: ReadableStream<Uint8Array>, isStderr: boolean) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          const out = isStderr ? process.stderr : process.stdout;
          out.write(`${colors.yellow}[server]${colors.reset} ${line}\n`);
        }
      }
    }
  };

  streamLines(proc.stdout, false);
  streamLines(proc.stderr, true);

  // Wait for server to be ready
  const start = Date.now();
  while (Date.now() - start < 15_000) {
    try {
      const resp = await fetch(`http://127.0.0.1:${options.port}/api/health`);
      if (resp.ok) {
        log(`Server ready on port ${options.port}`);
        return proc;
      }
    } catch {
      // not ready
    }
    await Bun.sleep(200);
  }

  throw new Error("Executor server did not become ready within 15s");
}

// ── Main ──

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command !== "start") {
    console.log(`
${colors.bold}executor${colors.reset} — local code execution server

Usage:
  executor start [options]

Options:
  --port <n>          Executor server port (default: 4001)
  --convex-port <n>   Convex backend port (default: 3210)
  --auto-execute      Auto-execute tasks on creation
  --data-dir <path>   Data directory (default: ~/.executor)
`);
    process.exit(command === "help" || command === "--help" ? 0 : 1);
  }

  console.log(`\n${colors.bold}${colors.cyan}executor${colors.reset} starting up...\n`);

  const procs: Bun.Subprocess[] = [];

  const cleanup = () => {
    console.log(`\n${colors.dim}Shutting down...${colors.reset}`);
    for (const p of procs) {
      try {
        p.kill();
      } catch {}
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    // 1. Ensure convex-local-backend binary
    logStep("Checking convex-local-backend binary...");
    const binaryPath = await ensureBinary();

    // 2. Start (or connect to) convex backend
    const backend = await startBackend(binaryPath, options.convexPort);
    if (backend.proc) procs.push(backend.proc);

    // 3. Push functions
    await pushFunctions(backend.url, backend.adminKey);

    // 4. Start executor server
    const serverProc = await startServer(options, backend.url);
    procs.push(serverProc);

    console.log(`
${colors.bold}${colors.green}✓ Executor ready${colors.reset}

  Server:   http://127.0.0.1:${options.port}
  MCP:      http://127.0.0.1:${options.port}/mcp
  Convex:   ${backend.url}
  Instance: ${backend.instanceName}
`);

    // Keep alive
    await new Promise(() => {});
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    cleanup();
  }
}

main();
