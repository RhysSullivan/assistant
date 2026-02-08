/**
 * Dev runner — starts all services concurrently with colored output.
 *
 * Usage: bun dev
 *
 * Starts:
 *   1. Convex cloud dev function push (once)
 *   2. Convex cloud dev function watcher
 *   3. Executor server (port 4001)
 *   4. Executor web UI (port 3002)
 *   5. Assistant server (port 3000)
 *   6. Discord bot
 *
 * All processes are killed when this script exits (Ctrl+C).
 */

const colors = {
  convex: "\x1b[36m",   // cyan
  executor: "\x1b[33m", // yellow
  web: "\x1b[34m",      // blue
  assistant: "\x1b[32m", // green
  bot: "\x1b[35m",      // magenta
  reset: "\x1b[0m",
};

type ServiceName = keyof typeof colors;

function prefix(name: ServiceName, line: string): string {
  return `${colors[name]}[${name}]${colors.reset} ${line}`;
}

const procs: Bun.Subprocess[] = [];

async function resolveExecutorConvexUrl(): Promise<string> {
  if (Bun.env.CONVEX_URL) {
    return Bun.env.CONVEX_URL;
  }

  const envFile = Bun.file("./executor/.env.local");
  if (!(await envFile.exists())) {
    throw new Error("Missing executor/.env.local with CONVEX_URL");
  }

  const content = await envFile.text();
  const line = content
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("CONVEX_URL="));

  if (!line) {
    throw new Error("CONVEX_URL not found in executor/.env.local");
  }

  const url = line.slice("CONVEX_URL=".length).trim();
  if (!url) {
    throw new Error("CONVEX_URL is empty in executor/.env.local");
  }
  return url;
}

function spawnService(name: ServiceName, cmd: string[], opts: {
  cwd?: string;
  env?: Record<string, string>;
} = {}): Bun.Subprocess {
  console.log(prefix(name, `Starting: ${cmd.join(" ")}`));
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ".",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, FORCE_COLOR: "1", ...opts.env },
  });
  procs.push(proc);

  const stream = async (s: ReadableStream<Uint8Array>, isErr: boolean) => {
    const reader = s.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) {
          (isErr ? process.stderr : process.stdout).write(prefix(name, line) + "\n");
        }
      }
    }
    if (buf.trim()) {
      (isErr ? process.stderr : process.stdout).write(prefix(name, buf) + "\n");
    }
  };

  stream(proc.stdout, false);
  stream(proc.stderr, true);
  proc.exited.then((code) => console.log(prefix(name, `Exited with code ${code}`)));
  return proc;
}

// ── Convex cloud deployment ──

async function pushConvexFunctions(): Promise<void> {
  console.log(prefix("convex", "Pushing functions..."));

  const proc = Bun.spawn([
    "bunx", "convex", "dev", "--once",
    "--typecheck", "disable",
  ], {
    cwd: "./executor",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, FORCE_COLOR: "1" },
  });

  const stdout = await Bun.readableStreamToText(proc.stdout);
  const stderr = await Bun.readableStreamToText(proc.stderr);
  const code = await proc.exited;

  if (stdout.trim()) console.log(prefix("convex", stdout.trim()));
  if (code !== 0) {
    console.error(prefix("convex", `Push failed (exit ${code}): ${stderr.trim()}`));
    throw new Error("Convex function push failed");
  }
  console.log(prefix("convex", "Functions ready!"));
}

// ── Cleanup ──

process.on("SIGINT", () => {
  console.log("\nShutting down all services...");
  for (const proc of procs) proc.kill();
  process.exit(0);
});
process.on("SIGTERM", () => {
  for (const proc of procs) proc.kill();
  process.exit(0);
});

// ── Start everything ──

console.log("Starting all services...\n");
if (!Bun.env.DISCORD_BOT_TOKEN) {
  console.log(`${colors.bot}[bot]${colors.reset} Skipped — no DISCORD_BOT_TOKEN set\n`);
}

// 1. Push functions (must complete before executor starts)
await pushConvexFunctions();

const executorConvexUrl = await resolveExecutorConvexUrl();
console.log(prefix("convex", `Using deployment URL: ${executorConvexUrl}`));

// 2. Start Convex file watcher (repushes on changes)
spawnService("convex", [
  "bunx", "convex", "dev",
  "--typecheck", "disable",
], {
  cwd: "./executor",
});

// 3. Everything else in parallel
spawnService("executor", ["bun", "--hot", "apps/server/src/index.ts"], {
  cwd: "./executor",
  env: {
    EXECUTOR_SERVER_AUTO_EXECUTE: "1",
    CONVEX_URL: executorConvexUrl,
    EXECUTOR_CONVEX_URL: executorConvexUrl,
  },
});

spawnService("web", ["bun", "run", "dev", "--", "-p", "3002"], {
  cwd: "./executor/apps/web",
});

// Small delay for executor to be ready
await Bun.sleep(2000);

spawnService("assistant", ["bun", "run", "--cwd", "packages/server", "dev"], {
  cwd: "./assistant",
  env: {
    CONVEX_URL: executorConvexUrl,
  },
});

if (Bun.env.DISCORD_BOT_TOKEN) {
  await Bun.sleep(1000);
  spawnService("bot", ["bun", "run", "--cwd", "packages/bot", "dev"], {
    cwd: "./assistant",
    env: {
      CONVEX_URL: executorConvexUrl,
    },
  });
}

// Keep alive
await new Promise(() => {});
