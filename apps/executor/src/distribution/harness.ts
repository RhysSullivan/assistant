import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { buildDistributionPackage } from "./artifact";

type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export class DistributionHarness extends Context.Tag(
  "@executor-v3/apps/executor/distribution/DistributionHarness",
)<
  DistributionHarness,
  {
    readonly packageDir: string;
    readonly launcherPath: string;
    readonly tarballPath: string;
    readonly executorHome: string;
    readonly baseUrl: string;
    readonly run: (
      args: ReadonlyArray<string>,
      options?: {
        readonly okExitCodes?: ReadonlyArray<number>;
      },
    ) => Effect.Effect<CommandResult, Error, never>;
    readonly runInstalled: (
      args: ReadonlyArray<string>,
      options?: {
        readonly okExitCodes?: ReadonlyArray<number>;
      },
    ) => Effect.Effect<CommandResult, Error, never>;
    readonly fetchText: (
      pathname: string,
    ) => Effect.Effect<{
      readonly status: number;
      readonly body: string;
      readonly contentType: string | null;
    }, Error, never>;
  }
>() {}

const runCommand = (input: {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly okExitCodes?: ReadonlyArray<number>;
}): Effect.Effect<CommandResult, Error, never> =>
  Effect.async((resume) => {
    const child = spawn(input.command, [...input.args], {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });

    child.once("error", (error) => {
      resume(Effect.fail(error));
    });

    child.once("close", (code) => {
      const exitCode = code ?? -1;
      const result = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
      } satisfies CommandResult;
      const okExitCodes = input.okExitCodes ?? [0];

      if (okExitCodes.includes(exitCode)) {
        resume(Effect.succeed(result));
        return;
      }

      resume(Effect.fail(new Error(
        [
          `${input.command} ${input.args.join(" ")} exited with code ${exitCode}`,
          stdout.length > 0 ? `stdout:\n${stdout.trim()}` : null,
          stderr.length > 0 ? `stderr:\n${stderr.trim()}` : null,
        ].filter((part) => part !== null).join("\n\n"),
      )));
    });

    return Effect.sync(() => {
      child.kill("SIGTERM");
    });
  });

const allocatePort = (): Effect.Effect<number, Error, never> =>
  Effect.tryPromise({
    try: async () => {
      return await new Promise<number>((resolvePort, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            server.close(() => reject(new Error("Failed to allocate test port")));
            return;
          }

          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolvePort(address.port);
          });
        });
      });
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });

const buildPackage = (packageDir: string) =>
  Effect.tryPromise({
    try: () => buildDistributionPackage({
      outputDir: packageDir,
      buildWeb: false,
    }),
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });

const packPackage = (packageDir: string, outputDir: string) =>
  runCommand({
    command: "npm",
    args: ["pack", packageDir],
    cwd: outputDir,
  }).pipe(
    Effect.flatMap((result) => {
      const tarballName = result.stdout
        .split(/\s+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .at(-1);

      if (!tarballName) {
        return Effect.fail(
          new Error(`Unable to determine tarball name from npm pack output: ${result.stdout}`),
        );
      }

      return Effect.succeed(join(outputDir, tarballName));
    }),
  );

export const LocalDistributionHarnessLive = Layer.scoped(
  DistributionHarness,
  Effect.gen(function* () {
    const tempRoot = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => mkdtemp(join(tmpdir(), "executor-distribution-")),
        catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
      }),
      (path) => Effect.tryPromise({
        try: () => rm(path, { recursive: true, force: true }),
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause ?? "temp dir cleanup failed")),
      }).pipe(Effect.orDie),
    );

    const packageDir = join(tempRoot, "package");
    const prefixDir = join(tempRoot, "prefix");
    const homeDir = join(tempRoot, "home");
    const executorHome = join(homeDir, ".executor");
    const baseUrl = `http://127.0.0.1:${yield* allocatePort()}`;

    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(prefixDir, { recursive: true });
        await mkdir(homeDir, { recursive: true });
        await mkdir(executorHome, { recursive: true });
      },
      catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
    });

    const artifact = yield* buildPackage(packageDir);
    const tarballPath = yield* packPackage(packageDir, tempRoot);


    const env = {
      ...process.env,
      HOME: homeDir,
      EXECUTOR_HOME: executorHome,
    } satisfies NodeJS.ProcessEnv;

    const installedEnv = {
      ...env,
      NPM_CONFIG_PREFIX: prefixDir,
      PATH: `${join(prefixDir, "bin")}:${process.env.PATH ?? ""}`,
    } satisfies NodeJS.ProcessEnv;

    yield* runCommand({
      command: "npm",
      args: ["install", "-g", tarballPath],
      cwd: tempRoot,
      env: installedEnv,
    });

    const run = (
      args: ReadonlyArray<string>,
      options?: { readonly okExitCodes?: ReadonlyArray<number> },
    ) =>
      runCommand({
        command: "node",
        args: [artifact.launcherPath, ...args],
        cwd: dirname(artifact.launcherPath),
        env,
        okExitCodes: options?.okExitCodes,
      });

    const runInstalled = (
      args: ReadonlyArray<string>,
      options?: { readonly okExitCodes?: ReadonlyArray<number> },
    ) =>
      runCommand({
        command: "executor",
        args,
        cwd: tempRoot,
        env: installedEnv,
        okExitCodes: options?.okExitCodes,
      });

    const fetchText = (pathname: string) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(new URL(pathname, baseUrl));
          return {
            status: response.status,
            body: await response.text(),
            contentType: response.headers.get("content-type"),
          };
        },
        catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
      });

    return DistributionHarness.of({
      packageDir,
      launcherPath: artifact.launcherPath,
      tarballPath,
      executorHome,
      baseUrl,
      run,
      runInstalled,
      fetchText,
    });
  }),
);
