import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONVEX_BACKEND_REPO = "get-convex/convex-backend";

export interface ManagedRuntimeConfig {
  instanceName: string;
  instanceSecret: string;
  hostInterface: string;
  backendPort: number;
  siteProxyPort: number;
}

export interface ManagedRuntimeInfo {
  rootDir: string;
  backendDir: string;
  backendBinary: string;
  backendAssetName: string;
  backendDownloadUrl: string;
  dbPath: string;
  storageDir: string;
  configPath: string;
  config: ManagedRuntimeConfig;
}

function runtimeRootDir(): string {
  const configured = Bun.env.EXECUTOR_RUNTIME_DIR;
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  return path.join(os.homedir(), ".executor", "runtime");
}

function backendBinaryName(): string {
  return process.platform === "win32" ? "convex-local-backend.exe" : "convex-local-backend";
}

function backendAssetName(): string {
  if (process.platform === "linux" && process.arch === "x64") {
    return "convex-local-backend-x86_64-unknown-linux-gnu.zip";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "convex-local-backend-aarch64-unknown-linux-gnu.zip";
  }
  if (process.platform === "darwin" && process.arch === "x64") {
    return "convex-local-backend-x86_64-apple-darwin.zip";
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "convex-local-backend-aarch64-apple-darwin.zip";
  }

  throw new Error(
    `Unsupported platform/arch for managed Convex backend: ${process.platform}/${process.arch}`,
  );
}

function randomHex(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return [...value].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function defaultConfig(): ManagedRuntimeConfig {
  const backendPort = Number(Bun.env.EXECUTOR_BACKEND_PORT ?? 5410);
  const siteProxyPort = Number(Bun.env.EXECUTOR_BACKEND_SITE_PORT ?? 5411);
  return {
    instanceName: Bun.env.EXECUTOR_INSTANCE_NAME ?? "executor-local",
    instanceSecret: Bun.env.EXECUTOR_INSTANCE_SECRET ?? randomHex(32),
    hostInterface: Bun.env.EXECUTOR_BACKEND_INTERFACE ?? "127.0.0.1",
    backendPort,
    siteProxyPort,
  };
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: "inherit" | "ignore";
    stdout?: "inherit" | "pipe";
    stderr?: "inherit" | "pipe";
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([command, ...args], {
    cwd: options?.cwd,
    env: options?.env,
    stdin: options?.stdin ?? "inherit",
    stdout: options?.stdout ?? "inherit",
    stderr: options?.stderr ?? "inherit",
  });

  const exitCode = await proc.exited;
  const stdout = options?.stdout === "pipe" ? await new Response(proc.stdout).text() : "";
  const stderr = options?.stderr === "pipe" ? await new Response(proc.stderr).text() : "";

  return { exitCode, stdout, stderr };
}

async function downloadWithFetch(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed downloading Convex backend from ${url} (${response.status})`);
  }

  const totalBytes = Number(response.headers.get("content-length") ?? "0");
  const totalMb = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : null;

  const file = await fs.open(destinationPath, "w");
  let downloadedBytes = 0;
  let nextPercentLog = 10;
  let nextMbLog = 25;

  try {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      await file.write(chunk.value);
      downloadedBytes += chunk.value.byteLength;

      if (totalBytes > 0) {
        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
        if (percent >= nextPercentLog) {
          console.log(`[executor] download progress ${percent}% (${(downloadedBytes / (1024 * 1024)).toFixed(1)}MB/${totalMb}MB)`);
          nextPercentLog += 10;
        }
      } else {
        const mb = downloadedBytes / (1024 * 1024);
        if (mb >= nextMbLog) {
          console.log(`[executor] downloaded ${mb.toFixed(1)}MB`);
          nextMbLog += 25;
        }
      }
    }
  } finally {
    await file.close();
  }
}

async function downloadArchive(url: string, destinationPath: string): Promise<void> {
  try {
    const curl = await runProcess("curl", ["-fL", "--progress-bar", "-o", destinationPath, url], {
      stdin: "ignore",
    });
    if (curl.exitCode === 0) {
      return;
    }
  } catch {
    // curl unavailable; use fetch fallback below.
  }

  console.log("[executor] curl unavailable, falling back to fetch downloader");
  await downloadWithFetch(url, destinationPath);
}

async function extractZipArchive(archivePath: string, destinationDir: string): Promise<void> {
  try {
    const unzip = await runProcess("unzip", ["-o", archivePath, "-d", destinationDir], {
      stdin: "ignore",
    });
    if (unzip.exitCode === 0) {
      return;
    }
  } catch {
    // Fall through to python fallback.
  }

  const script = [
    "import sys, zipfile",
    "zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
  ].join(";");
  const python = await runProcess("python3", ["-c", script, archivePath, destinationDir], {
    stdin: "ignore",
  });
  if (python.exitCode !== 0) {
    throw new Error("Failed to extract Convex backend archive. Install unzip or python3.");
  }
}

function runtimeInfo(): ManagedRuntimeInfo {
  const rootDir = runtimeRootDir();
  const backendDir = path.join(rootDir, "convex-backend");
  const backendAsset = backendAssetName();
  const backendBinary = path.join(backendDir, backendBinaryName());
  const dbPath = path.join(rootDir, "convex-data", "convex_local_backend.sqlite3");
  const storageDir = path.join(rootDir, "convex-data", "storage");
  const configPath = path.join(rootDir, "convex-backend.json");

  return {
    rootDir,
    backendDir,
    backendBinary,
    backendAssetName: backendAsset,
    backendDownloadUrl: `https://github.com/${CONVEX_BACKEND_REPO}/releases/latest/download/${backendAsset}`,
    dbPath,
    storageDir,
    configPath,
    config: defaultConfig(),
  };
}

async function ensureConfig(info: ManagedRuntimeInfo): Promise<ManagedRuntimeConfig> {
  if (await pathExists(info.configPath)) {
    const raw = await fs.readFile(info.configPath, "utf8");
    const parsed = JSON.parse(raw) as ManagedRuntimeConfig;
    return parsed;
  }

  const config = defaultConfig();
  await fs.mkdir(path.dirname(info.configPath), { recursive: true });
  await fs.writeFile(info.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}

async function ensureBackendBinary(info: ManagedRuntimeInfo): Promise<void> {
  if (await pathExists(info.backendBinary)) {
    return;
  }

  await fs.mkdir(info.backendDir, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "executor-convex-backend-"));
  const archivePath = path.join(tempDir, info.backendAssetName);

  try {
    console.log(`[executor] downloading managed Convex backend (${info.backendAssetName})`);
    await downloadArchive(info.backendDownloadUrl, archivePath);

    console.log("[executor] extracting managed Convex backend binary");
    await extractZipArchive(archivePath, info.backendDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  if (!(await pathExists(info.backendBinary))) {
    throw new Error(`Convex backend install incomplete. Expected binary at ${info.backendBinary}`);
  }

  if (process.platform !== "win32") {
    await fs.chmod(info.backendBinary, 0o755);
  }
}

function backendArgs(info: ManagedRuntimeInfo, additionalArgs: string[]): string[] {
  const cfg = info.config;
  return [
    "--instance-name",
    cfg.instanceName,
    "--instance-secret",
    cfg.instanceSecret,
    "--interface",
    cfg.hostInterface,
    "--port",
    String(cfg.backendPort),
    "--site-proxy-port",
    String(cfg.siteProxyPort),
    "--local-storage",
    info.storageDir,
    info.dbPath,
    ...additionalArgs,
  ];
}

export async function ensureManagedRuntime(): Promise<ManagedRuntimeInfo> {
  const info = runtimeInfo();
  await fs.mkdir(path.dirname(info.dbPath), { recursive: true });
  await fs.mkdir(info.storageDir, { recursive: true });
  info.config = await ensureConfig(info);
  await ensureBackendBinary(info);
  console.log("[executor] managed Convex backend runtime ready");
  return info;
}

export async function runManagedBackend(args: string[]): Promise<number> {
  const info = await ensureManagedRuntime();
  const proc = await runProcess(info.backendBinary, backendArgs(info, args));
  return proc.exitCode;
}

export async function backendVersion(info: ManagedRuntimeInfo): Promise<string> {
  const version = await runProcess(info.backendBinary, ["--version"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (version.exitCode !== 0) {
    return "unknown";
  }
  const text = version.stdout.trim();
  return text.length > 0 ? text : "unknown";
}

export async function managedRuntimeDiagnostics(): Promise<ManagedRuntimeInfo & { backendVersion: string; convexUrl: string; convexSiteUrl: string }> {
  const info = await ensureManagedRuntime();
  const backendVer = await backendVersion(info);

  return {
    ...info,
    backendVersion: backendVer,
    convexUrl: `http://${info.config.hostInterface}:${info.config.backendPort}`,
    convexSiteUrl: `http://${info.config.hostInterface}:${info.config.siteProxyPort}`,
  };
}
