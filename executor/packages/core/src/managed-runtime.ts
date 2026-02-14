import fs from "node:fs/promises";
import path from "node:path";

import { ensureProjectBootstrapped, waitForBackendReady } from "./managed/runtime-bootstrap";
import { backendArgs, ensureConfig, runtimeInfo } from "./managed/runtime-info";
import { ensureBackendBinary, ensureNodeRuntime, ensureWebBundle } from "./managed/runtime-installation";
import { runProcess } from "./managed/runtime-process";

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
  nodeDir: string;
  nodeBin: string;
  npmBin: string;
  npmPrefix: string;
  convexCliEntry: string;
  webDir: string;
  webServerEntry: string;
  webArtifactName: string;
  webDownloadUrl: string;
}

export async function ensureManagedRuntime(options: { quiet?: boolean } = {}): Promise<ManagedRuntimeInfo> {
  const info = runtimeInfo();
  await fs.mkdir(path.dirname(info.dbPath), { recursive: true });
  await fs.mkdir(info.storageDir, { recursive: true });
  info.config = await ensureConfig(info);
  await ensureBackendBinary(info);
  if (!options.quiet) {
    console.log("[executor] managed Convex backend runtime ready");
  }
  return info;
}

export async function runManagedBackend(args: string[]): Promise<number> {
  const info = await ensureManagedRuntime();

  if (args.length === 0) {
    try {
      await waitForBackendReady(info, 1_000);
      console.log("[executor] managed backend is already running");
      try {
        await ensureProjectBootstrapped(info);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[executor] bootstrap skipped: ${message}`);
      }
      return 0;
    } catch {
      // not running yet, continue and start it now
    }
  }

  const env = {
    ...process.env,
    PATH: `${path.dirname(info.nodeBin)}:${process.env.PATH ?? ""}`,
  };

  const proc = Bun.spawn([info.backendBinary, ...backendArgs(info, args)], {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (args.length === 0) {
    try {
      await waitForBackendReady(info);
      await ensureProjectBootstrapped(info);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[executor] bootstrap skipped: ${message}`);
    }
  }

  return await proc.exited;
}

export async function runManagedWeb(options: { port?: number } = {}): Promise<number> {
  const info = await ensureManagedRuntime();
  try {
    await waitForBackendReady(info, 1_000);
  } catch {
    console.warn("[executor] managed backend is not running. Start it with 'executor up' before using the web UI.");
  }
  await ensureNodeRuntime(info);
  await ensureWebBundle(info);

  const webPort = options.port ?? Number(Bun.env.EXECUTOR_WEB_PORT ?? 5312);
  const host = Bun.env.EXECUTOR_WEB_INTERFACE ?? "127.0.0.1";

  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(webPort),
    HOSTNAME: host,
    CONVEX_URL: process.env.CONVEX_URL ?? `http://${info.config.hostInterface}:${info.config.backendPort}`,
    CONVEX_SITE_URL: process.env.CONVEX_SITE_URL ?? `http://${info.config.hostInterface}:${info.config.siteProxyPort}`,
  };

  const proc = await runProcess(info.nodeBin, [info.webServerEntry], {
    cwd: info.webDir,
    env,
  });
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
  const info = await ensureManagedRuntime({ quiet: true });
  const backendVer = await backendVersion(info);

  return {
    ...info,
    backendVersion: backendVer,
    convexUrl: `http://${info.config.hostInterface}:${info.config.backendPort}`,
    convexSiteUrl: `http://${info.config.hostInterface}:${info.config.siteProxyPort}`,
  };
}
