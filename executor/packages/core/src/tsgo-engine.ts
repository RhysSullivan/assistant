import { Result } from "better-result";
import { TYPECHECK_OK, type TypecheckResult } from "./typecheck-contract";

let warnedTsgoUnavailable = false;
let warnedTsgoFallback = false;
let resolvedTsgoExecutablePath: string | null | undefined;

function getNodeProcess(): { env?: Record<string, string | undefined>; platform?: string; arch?: string } | null {
  const candidate = (globalThis as { process?: unknown }).process;
  return candidate && typeof candidate === "object"
    ? (candidate as { env?: Record<string, string | undefined>; platform?: string; arch?: string })
    : null;
}

function getNodeRequire(): ((id: string) => any) | null {
  return Result.try(() => {
    const candidate = Function("return typeof require === 'function' ? require : null;")() as unknown;
    return typeof candidate === "function" ? (candidate as (id: string) => any) : null;
  }).unwrapOr(null);
}

export function wantsTsgoTypecheckEngine(): boolean {
  const configured = getNodeProcess()?.env?.EXECUTOR_TYPECHECK_ENGINE?.trim().toLowerCase();
  if (!configured || configured === "auto") return true;
  if (configured === "typescript") return false;
  return configured === "tsgo";
}

function resolveTsgoExecutablePath(opts?: { silentIfMissing?: boolean }): string | null {
  if (resolvedTsgoExecutablePath !== undefined) {
    return resolvedTsgoExecutablePath;
  }

  const result = Result.try(() => {
    const processRef = getNodeProcess();
    const platform = processRef?.platform;
    const arch = processRef?.arch;
    if (!platform || !arch) {
      throw new Error("Node platform information unavailable");
    }

    const requireFn = getNodeRequire();
    if (!requireFn) {
      throw new Error("Node require() unavailable");
    }

    const fs = requireFn("fs");
    const path = requireFn("path");
    const platformPackageName = `@typescript/native-preview-${platform}-${arch}`;
    const packageJsonPath = (requireFn as { resolve?: (id: string) => string }).resolve?.(`${platformPackageName}/package.json`);
    if (!packageJsonPath) {
      throw new Error(`Unable to resolve ${platformPackageName}/package.json`);
    }

    const executableName = platform === "win32" ? "tsgo.exe" : "tsgo";
    const executablePath = path.join(path.dirname(packageJsonPath), "lib", executableName);
    if (!fs.existsSync(executablePath)) {
      throw new Error(`Executable not found at ${executablePath}`);
    }

    return executablePath;
  });

  if (result.isOk()) {
    resolvedTsgoExecutablePath = result.value;
    return result.value;
  }

  resolvedTsgoExecutablePath = null;
  if (!opts?.silentIfMissing && !warnedTsgoUnavailable) {
    warnedTsgoUnavailable = true;
    console.warn(
      `[executor] tsgo requested but unavailable, falling back to TypeScript compiler API: ${result.error.message}`,
    );
  }

  return null;
}

function parseTsgoDiagnosticsInternal(output: string, headerLineCount: number): {
  userErrors: string[];
  matchedDiagnostics: number;
} {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const errors: string[] = [];
  let matchedDiagnostics = 0;
  const pattern = /(?:^|[\\/])generated\.ts\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)$/;

  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) continue;

    matchedDiagnostics += 1;
    const absoluteLine = Number.parseInt(match[1] ?? "", 10);
    const message = (match[3] ?? "Type error").trim();
    if (!Number.isFinite(absoluteLine) || absoluteLine <= headerLineCount) {
      continue;
    }

    errors.push(`Line ${absoluteLine - headerLineCount}: ${message}`);
  }

  return {
    userErrors: errors,
    matchedDiagnostics,
  };
}

export function parseTsgoDiagnostics(output: string, headerLineCount: number): string[] {
  return parseTsgoDiagnosticsInternal(output, headerLineCount).userErrors;
}

export function runTsgoTypecheck(
  wrappedCode: string,
  headerLineCount: number,
): TypecheckResult | null {
  const configured = getNodeProcess()?.env?.EXECUTOR_TYPECHECK_ENGINE?.trim().toLowerCase();
  const explicitTsgo = configured === "tsgo";
  const executablePath = resolveTsgoExecutablePath({ silentIfMissing: !explicitTsgo });
  if (!executablePath) {
    return null;
  }

  const result = Result.try(() => {
    const requireFn = getNodeRequire();
    if (!requireFn) {
      throw new Error("Node require() unavailable");
    }

    const fs = requireFn("fs");
    const os = requireFn("os");
    const path = requireFn("path");
    const childProcess = requireFn("child_process");
    const spawnSync = childProcess?.spawnSync;
    if (typeof spawnSync !== "function") {
      throw new Error("child_process.spawnSync unavailable");
    }

    const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "executor-tsgo-"));
    const sourcePath = path.join(tempDirectory, "generated.ts");
    const tsconfigPath = path.join(tempDirectory, "tsconfig.json");

    try {
      fs.writeFileSync(sourcePath, wrappedCode, "utf8");
      fs.writeFileSync(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            strict: true,
            noEmit: true,
            lib: ["es2022"],
            types: [],
          },
          files: ["generated.ts"],
        }),
        "utf8",
      );

      const command = spawnSync(
        executablePath,
        ["--pretty", "false", "--project", tsconfigPath],
        {
          cwd: tempDirectory,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      if (command.error) {
        throw command.error;
      }

      if ((command.status ?? 1) === 0) {
        return TYPECHECK_OK;
      }

      const output = `${command.stdout ?? ""}\n${command.stderr ?? ""}`;
      const diagnostics = parseTsgoDiagnosticsInternal(output, headerLineCount);
      if (diagnostics.userErrors.length > 0) {
        return {
          ok: false,
          errors: diagnostics.userErrors,
        } as const;
      }

      if (diagnostics.matchedDiagnostics > 0) {
        return TYPECHECK_OK;
      }

      const fallbackMessage = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, 3)
        .join(" | ");

      return {
        ok: false,
        errors: [fallbackMessage.length > 0 ? fallbackMessage : "tsgo typecheck failed"],
      } as const;
    } finally {
      fs.rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  if (result.isOk()) {
    return result.value;
  }

  if (!warnedTsgoFallback) {
    warnedTsgoFallback = true;
    console.warn(
      `[executor] tsgo typecheck failed, falling back to TypeScript compiler API: ${result.error.message}`,
    );
  }

  return null;
}
