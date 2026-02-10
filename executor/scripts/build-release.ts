#!/usr/bin/env bun

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

type ReleaseTarget = {
  platform: "linux" | "darwin";
  arch: "x64" | "arm64";
  bunTarget: string;
};

const targets: ReleaseTarget[] = [
  { platform: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { platform: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { platform: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { platform: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
];

function archiveName(platform: ReleaseTarget["platform"], arch: ReleaseTarget["arch"]): string {
  return `executor-${platform}-${arch}.tar.gz`;
}

async function sha256(filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).arrayBuffer();
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

async function runArchiveCommand(command: string[], cwd?: string): Promise<void> {
  const proc = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`Command failed (${code}): ${command.join(" ")}`);
  }
}

async function main(): Promise<void> {
  const rootDir = path.resolve(import.meta.dir, "..");
  const releaseDir = path.join(rootDir, "dist", "release");

  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.mkdir(releaseDir, { recursive: true });

  const checksums: string[] = [];

  for (const target of targets) {
    const dirName = `executor-${target.platform}-${target.arch}`;
    const bundleDir = path.join(releaseDir, dirName);
    const binDir = path.join(bundleDir, "bin");
    const binName = "executor";
    const binPath = path.join(binDir, binName);

    await fs.mkdir(binDir, { recursive: true });

    const build = await Bun.build({
      entrypoints: [path.join(rootDir, "executor.ts")],
      compile: {
        target: target.bunTarget as never,
        outfile: binPath,
      },
    });

    if (!build.success) {
      const logs = build.logs.map((log) => log.message).join("\n");
      throw new Error(`Failed to compile target ${target.bunTarget}\n${logs}`);
    }

    const archivePath = path.join(releaseDir, archiveName(target.platform, target.arch));
    await runArchiveCommand(["tar", "-czf", archivePath, "-C", binDir, binName]);

    const digest = await sha256(archivePath);
    checksums.push(`${digest}  ${path.basename(archivePath)}`);
    console.log(`built ${path.basename(archivePath)}`);
  }

  await Bun.write(path.join(releaseDir, "checksums.txt"), `${checksums.join("\n")}\n`);
  console.log(`wrote ${path.join("dist", "release", "checksums.txt")}`);
}

await main();
