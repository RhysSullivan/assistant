import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ManagedRuntimeInfo } from "../managed-runtime";
import { downloadArchive, extractTarArchive, extractZipArchive } from "./runtime-archives";
import { managedRuntimeVersions, nodeArchiveName, pathExists } from "./runtime-info";
import { runProcess } from "./runtime-process";

export async function ensureBackendBinary(info: ManagedRuntimeInfo): Promise<void> {
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

export async function ensureNodeRuntime(info: ManagedRuntimeInfo): Promise<void> {
  if (await pathExists(info.nodeBin)) {
    return;
  }

  const archiveName = nodeArchiveName();
  const archiveUrl = `https://nodejs.org/dist/v${managedRuntimeVersions.nodeVersion}/${archiveName}`;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "executor-node-runtime-"));
  const archivePath = path.join(tempDir, archiveName);
  try {
    await fs.mkdir(info.rootDir, { recursive: true });
    console.log(`[executor] downloading managed Node runtime (${archiveName})`);
    await downloadArchive(archiveUrl, archivePath);

    console.log("[executor] extracting managed Node runtime");
    await extractTarArchive(archivePath, info.rootDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  if (!(await pathExists(info.nodeBin))) {
    throw new Error(`Node runtime install incomplete. Expected node executable at ${info.nodeBin}`);
  }
}

export async function ensureConvexCliRuntime(info: ManagedRuntimeInfo): Promise<void> {
  if (await pathExists(info.convexCliEntry)) {
    return;
  }

  await ensureNodeRuntime(info);
  await fs.mkdir(info.npmPrefix, { recursive: true });

  const env = {
    ...process.env,
    PATH: `${path.dirname(info.nodeBin)}:${process.env.PATH ?? ""}`,
  };

  console.log(`[executor] installing managed Convex CLI (${managedRuntimeVersions.convexCliVersion})`);
  const install = await runProcess(
    info.npmBin,
    [
      "install",
      "--prefix",
      info.npmPrefix,
      "--no-audit",
      "--no-fund",
      "--loglevel",
      "error",
      `convex@${managedRuntimeVersions.convexCliVersion}`,
    ],
    { env },
  );

  if (install.exitCode !== 0 || !(await pathExists(info.convexCliEntry))) {
    throw new Error("Failed to install managed Convex CLI runtime.");
  }
}

export async function ensureWebBundle(info: ManagedRuntimeInfo): Promise<void> {
  if (await pathExists(info.webServerEntry)) {
    return;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "executor-web-bundle-"));
  const archivePath = path.join(tempDir, info.webArtifactName);
  const localFallbackArchive = path.resolve(import.meta.dir, "..", "dist", "release", info.webArtifactName);

  try {
    console.log(`[executor] downloading managed web bundle (${info.webArtifactName})`);
    try {
      await downloadArchive(info.webDownloadUrl, archivePath);
    } catch (error) {
      if (await pathExists(localFallbackArchive)) {
        console.log(`[executor] release web bundle unavailable, using local artifact ${localFallbackArchive}`);
        await fs.copyFile(localFallbackArchive, archivePath);
      } else {
        throw error;
      }
    }

    await fs.rm(info.webDir, { recursive: true, force: true });
    await fs.mkdir(info.webDir, { recursive: true });

    console.log("[executor] extracting managed web bundle");
    await extractTarArchive(archivePath, info.webDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  if (!(await pathExists(info.webServerEntry))) {
    throw new Error(`Web bundle install incomplete. Expected server entry at ${info.webServerEntry}`);
  }
}
