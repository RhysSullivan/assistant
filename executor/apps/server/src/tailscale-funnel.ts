interface CommandResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface FunnelStatusEntry {
  Handlers?: Record<string, { Proxy?: string }>;
}

interface FunnelStatus {
  Web?: Record<string, FunnelStatusEntry>;
  AllowFunnel?: Record<string, boolean>;
}

function runCommand(args: string[]): CommandResult {
  const proc = Bun.spawnSync(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const exitCode = proc.exitCode ?? 1;

  return {
    ok: exitCode === 0,
    exitCode,
    stdout,
    stderr,
  };
}

function normalizeHostname(hostnamePort: string): string {
  return hostnamePort.endsWith(":443") ? hostnamePort.slice(0, -4) : hostnamePort;
}

function extractFunnelUrlForPort(status: FunnelStatus, port: number): string | null {
  const web = status.Web;
  if (!web || typeof web !== "object") {
    return null;
  }

  const allowFunnel = status.AllowFunnel ?? {};

  for (const [host, entry] of Object.entries(web)) {
    if (allowFunnel[host] !== true) {
      continue;
    }

    const handlers = entry.Handlers;
    if (!handlers || typeof handlers !== "object") {
      continue;
    }

    for (const handler of Object.values(handlers)) {
      const proxy = handler.Proxy;
      if (typeof proxy !== "string") {
        continue;
      }

      if (proxy.includes(`:${port}`)) {
        return `https://${normalizeHostname(host)}`;
      }
    }
  }

  return null;
}

function readFunnelStatus(port: number): string | null {
  const statusResult = runCommand(["tailscale", "funnel", "status", "--json"]);
  if (!statusResult.ok || statusResult.stdout.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(statusResult.stdout) as FunnelStatus;
    return extractFunnelUrlForPort(parsed, port);
  } catch {
    return null;
  }
}

export interface EnsureFunnelResult {
  url: string;
  created: boolean;
}

export function ensureTailscaleFunnel(port: number): EnsureFunnelResult {
  const existing = readFunnelStatus(port);
  if (existing) {
    return { url: existing, created: false };
  }

  const startResult = runCommand([
    "tailscale",
    "funnel",
    "--bg",
    "--yes",
    String(port),
  ]);

  if (!startResult.ok) {
    const message = startResult.stderr.trim() || startResult.stdout.trim() || "unknown error";
    throw new Error(`tailscale funnel failed: ${message}`);
  }

  const created = readFunnelStatus(port);
  if (!created) {
    throw new Error("tailscale funnel started but no URL found in status output");
  }

  return { url: created, created: true };
}
