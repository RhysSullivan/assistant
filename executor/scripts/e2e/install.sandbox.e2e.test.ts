import { expect, test } from "bun:test";
import { Sandbox } from "@vercel/sandbox";
import { anonymousBootstrapCheckScript, runtimeConfigCheckScript, runtimeDoctorScript } from "./install-checks";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function runSandboxBash(
  sandbox: Sandbox,
  script: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<CommandResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const command = await sandbox.runCommand({
      cmd: "bash",
      args: ["-lc", script],
      env,
      signal: controller.signal,
    });

    const [stdout, stderr] = await Promise.all([command.stdout(), command.stderr()]);
    return {
      exitCode: command.exitCode,
      stdout,
      stderr,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isSandboxStoppedError(error: unknown): boolean {
  if (!error) return false;
  const record = error && typeof error === "object" ? error as Record<string, unknown> : null;
  const response = record?.response;
  const responseRecord = response && typeof response === "object" ? response as Record<string, unknown> : null;
  const status = typeof responseRecord?.status === "number" ? responseRecord.status : null;
  if (status === 410) return true;

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("sandbox_stopped") || message.includes("Status code 410");
}

function assertSuccess(result: CommandResult, label: string): void {
  if (result.exitCode === 0) {
    return;
  }

  throw new Error(
    [
      `${label} failed with exit code ${result.exitCode}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`,
    ].join("\n\n"),
  );
}

test("installer works in fresh Vercel sandbox", async () => {
  const backendPort = 5410;
  const sitePort = 5411;
  const webPort = 5312;

  const credentials =
    process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID
      ? {
          token: process.env.VERCEL_TOKEN,
          teamId: process.env.VERCEL_TEAM_ID,
          projectId: process.env.VERCEL_PROJECT_ID,
        }
      : {};

  const createSandbox = async () => {
    try {
      return await Sandbox.create({
        runtime: "node22",
        ports: [webPort, backendPort, sitePort],
        timeout: 30 * 60 * 1000,
        ...credentials,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not create Vercel sandbox. Configure auth via VERCEL_TOKEN/VERCEL_TEAM_ID/VERCEL_PROJECT_ID or VERCEL_OIDC_TOKEN.\n\n${message}`,
      );
    }
  };

  let sandbox: Sandbox | null = await createSandbox();

  try {
    const buildSandboxEnv = (activeSandbox: Sandbox) => {
      const convexUrl = activeSandbox.domain(backendPort);
      const convexSiteUrl = activeSandbox.domain(sitePort);
      return {
        convexUrl,
        env: {
          EXECUTOR_BACKEND_INTERFACE: "0.0.0.0",
          EXECUTOR_WEB_INTERFACE: "0.0.0.0",
          EXECUTOR_BACKEND_PORT: String(backendPort),
          EXECUTOR_BACKEND_SITE_PORT: String(sitePort),
          EXECUTOR_WEB_PORT: String(webPort),
          CONVEX_URL: convexUrl,
          CONVEX_SITE_URL: convexSiteUrl,
          EXECUTOR_WEB_CONVEX_URL: convexUrl,
          EXECUTOR_WEB_CONVEX_SITE_URL: convexSiteUrl,
        },
      };
    };

    let sandboxSettings = buildSandboxEnv(sandbox);

    const installScript = [
      "set -euo pipefail",
      "cd ~",
      "if [ -x ~/.executor/bin/executor ]; then ~/.executor/bin/executor uninstall --yes || true; fi",
      "rm -rf ~/.executor",
      "start=$(date +%s)",
      "curl -fsSL https://executor.sh/install | bash -s -- --no-modify-path --no-star-prompt",
      "end=$(date +%s)",
      "echo INSTALL_SECONDS=$((end-start))",
      runtimeDoctorScript(),
    ].join("; ");

    let install: CommandResult;
    try {
      install = await runSandboxBash(sandbox, installScript, 900_000, sandboxSettings.env);
    } catch (error) {
      if (!isSandboxStoppedError(error)) {
        throw error;
      }
      // Vercel sandboxes can stop unexpectedly; recreate once and retry.
      try {
        await sandbox.stop();
      } catch {
        // ignore
      }
      sandbox = await createSandbox();
      sandboxSettings = buildSandboxEnv(sandbox);
      install = await runSandboxBash(sandbox, installScript, 900_000, sandboxSettings.env);
    }
    assertSuccess(install, "sandbox install + doctor");

    const output = `${install.stdout}\n${install.stderr}`;
    expect(output).toContain("Executor status: ready");
    const runtimeConfigCheck = await runSandboxBash(
      sandbox,
      runtimeConfigCheckScript({ webPort, expectedConvexUrl: sandboxSettings.convexUrl }),
      300_000,
      sandboxSettings.env,
    );
    assertSuccess(runtimeConfigCheck, "sandbox runtime config convex URL check");

    const anonymousCheck = await runSandboxBash(
      sandbox,
      anonymousBootstrapCheckScript({ backendPort, webPort }),
      300_000,
      sandboxSettings.env,
    );
    assertSuccess(anonymousCheck, "sandbox anonymous bootstrap check");

    const uninstallScript = [
      "set -euo pipefail",
      "~/.executor/bin/executor uninstall --yes",
      "test ! -e ~/.executor/runtime/convex-data/convex_local_backend.sqlite3",
    ].join("; ");

    const uninstall = await runSandboxBash(sandbox, uninstallScript, 300_000);
    assertSuccess(uninstall, "sandbox uninstall validation");
  } finally {
    await sandbox.stop();
  }
}, 1_200_000);
