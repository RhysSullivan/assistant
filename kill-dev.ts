/**
 * Kills any lingering dev processes from a previous `bun dev` run.
 *
 * Targets:
 *   - Processes listening on ports 3000 (assistant server) and 3002 (web UI)
 *   - `convex dev` watcher processes
 *   - `next dev` processes (web UI)
 *   - Discord bot (`packages/bot`)
 *   - Assistant server (`packages/server`)
 *   - Previous instances of `dev.ts` itself
 *
 * Safe to run even if nothing is running — exits 0 in all cases.
 */

// Build set of ancestor PIDs to never kill (ourselves, parent dev.ts,
// grandparent `bun run` wrapper, shell, etc.)
function getAncestorPids(): Set<string> {
  const pids = new Set<string>();
  let current = process.pid;
  // Walk up the process tree via /proc (Linux)
  for (let i = 0; i < 10; i++) {
    pids.add(String(current));
    try {
      const stat = require("fs").readFileSync(`/proc/${current}/stat`, "utf8");
      const ppid = Number(stat.split(" ")[3]);
      if (ppid <= 1) break;
      current = ppid;
    } catch {
      break;
    }
  }
  return pids;
}

const SAFE_PIDS = getAncestorPids();

const PORTS = [3000, 3002];

const PATTERNS = [
  { pattern: "convex dev", label: "convex dev" },
  { pattern: "next dev", label: "next dev" },
  { pattern: "packages/bot", label: "discord bot" },
  { pattern: "packages/server", label: "assistant server" },
  { pattern: "bun.*dev\\.ts", label: "dev.ts" },
];

async function killByPort(port: number): Promise<void> {
  try {
    const proc = Bun.spawn(["lsof", "-ti", `:${port}`], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await Bun.readableStreamToText(proc.stdout);
    await proc.exited;

    const pids = text
      .trim()
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    for (const pid of pids) {
      if (SAFE_PIDS.has(pid)) continue;
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`Killed PID ${pid} (port ${port})`);
      } catch {
        // already dead
      }
    }
  } catch {
    // lsof not found or no results — fine
  }
}

async function killByPattern(pattern: string, label: string): Promise<void> {
  try {
    const proc = Bun.spawn(["pgrep", "-f", pattern], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await Bun.readableStreamToText(proc.stdout);
    await proc.exited;

    const pids = text
      .trim()
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);

    for (const pid of pids) {
      if (SAFE_PIDS.has(pid)) continue;
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`Killed PID ${pid} (${label})`);
      } catch {
        // already dead
      }
    }
  } catch {
    // no matches — fine
  }
}

// Kill port listeners and pattern matches in parallel
await Promise.all([
  ...PORTS.map((port) => killByPort(port)),
  ...PATTERNS.map(({ pattern, label }) => killByPattern(pattern, label)),
]);

// Brief pause to let ports release
await Bun.sleep(300);

console.log("All previous dev processes cleaned up.");
