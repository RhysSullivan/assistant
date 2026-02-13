import fs from "node:fs/promises";

import { runProcess } from "./managed-runtime-process";

async function downloadWithFetch(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed downloading ${url} (${response.status})`);
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
          console.log(
            `[executor] download progress ${percent}% (${(downloadedBytes / (1024 * 1024)).toFixed(1)}MB/${totalMb}MB)`,
          );
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

export async function downloadArchive(url: string, destinationPath: string): Promise<void> {
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

export async function extractZipArchive(archivePath: string, destinationDir: string): Promise<void> {
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
    throw new Error("Failed to extract zip archive. Install unzip or python3.");
  }
}

export async function extractTarArchive(archivePath: string, destinationDir: string): Promise<void> {
  const untar = await runProcess("tar", ["-xzf", archivePath, "-C", destinationDir], {
    stdin: "ignore",
  });
  if (untar.exitCode !== 0) {
    throw new Error(`Failed to extract tar archive: ${archivePath}`);
  }
}
