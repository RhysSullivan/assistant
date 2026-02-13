import { Result } from "better-result";
import { TYPECHECK_OK, type TypecheckResult } from "./typecheck-contract";
import {
  getSourceFileParseDiagnostics,
  getTypeScriptModule,
} from "./typechecker-ts-utils";
import { runTsgoTypecheck, wantsTsgoTypecheckEngine } from "./tsgo-engine";

let warnedMissingCompilerHostSupport = false;
let warnedSemanticFallback = false;

function formatTypecheckError(
  ts: typeof import("typescript"),
  diagnostic: import("typescript").Diagnostic,
  headerLineCount: number,
): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.start !== undefined && diagnostic.file) {
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const adjustedLine = line + 1 - headerLineCount;
    if (adjustedLine > 0) {
      return `Line ${adjustedLine}: ${message}`;
    }
  }
  return message;
}

function runSyntaxOnlyTypecheck(
  ts: typeof import("typescript"),
  wrappedCode: string,
  headerLineCount: number,
): TypecheckResult {
  return Result.try(() => {
    const sourceFile = ts.createSourceFile(
      "generated.ts",
      wrappedCode,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    const diagnostics = getSourceFileParseDiagnostics(sourceFile);
    if (diagnostics.length === 0) return TYPECHECK_OK;
    return {
      ok: false,
      errors: diagnostics.map((diagnostic) => formatTypecheckError(ts, diagnostic, headerLineCount)),
    } as const;
  }).unwrapOr(TYPECHECK_OK);
}

function runSemanticTypecheck(
  ts: typeof import("typescript"),
  wrappedCode: string,
  headerLineCount: number,
): Result<TypecheckResult, Error> {
  return Result.try({
    try: () => {
      const sourceFile = ts.createSourceFile(
        "generated.ts",
        wrappedCode,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.TS,
      );

      const compilerOptions: import("typescript").CompilerOptions = {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        strict: true,
        noEmit: true,
        lib: ["lib.es2022.d.ts"],
        types: [],
      };

      const host = ts.createCompilerHost(compilerOptions);
      const originalGetSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (fileName, languageVersion) => {
        if (fileName === "generated.ts") return sourceFile;
        return originalGetSourceFile(fileName, languageVersion);
      };

      const program = ts.createProgram(["generated.ts"], compilerOptions, host);
      const diagnostics = program.getSemanticDiagnostics(sourceFile);
      if (diagnostics.length === 0) return TYPECHECK_OK;

      const userDiagnostics = diagnostics.filter((diagnostic) => {
        if (diagnostic.start !== undefined && diagnostic.file) {
          const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
          return line + 1 > headerLineCount;
        }
        return false;
      });

      if (userDiagnostics.length === 0) return TYPECHECK_OK;

      return {
        ok: false,
        errors: userDiagnostics.map((diagnostic) =>
          formatTypecheckError(ts, diagnostic, headerLineCount)
        ),
      } as const;
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  });
}

/**
 * Typecheck LLM-generated code against tool declarations.
 */
export function typecheckCode(
  code: string,
  toolDeclarations: string,
): TypecheckResult {
  const wrappedCode = [
    toolDeclarations,
    "declare var console: { log(...args: any[]): void; info(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void; };",
    "declare function setTimeout(fn: () => void, ms: number): number;",
    "declare function clearTimeout(id: number): void;",
    "async function __generated() {",
    code,
    "}",
  ].join("\n");

  const headerLineCount = toolDeclarations.split("\n").length + 4;

  if (wantsTsgoTypecheckEngine()) {
    const tsgoResult = runTsgoTypecheck(wrappedCode, headerLineCount);
    if (tsgoResult) {
      return tsgoResult;
    }
  }

  const ts = getTypeScriptModule();
  if (!ts) return TYPECHECK_OK;

  if (!ts.sys || typeof ts.sys.useCaseSensitiveFileNames !== "boolean") {
    if (!warnedMissingCompilerHostSupport) {
      warnedMissingCompilerHostSupport = true;
      console.warn(
        "[executor] TypeScript semantic typecheck unavailable in this runtime, using syntax-only checks.",
      );
    }
    return runSyntaxOnlyTypecheck(ts, wrappedCode, headerLineCount);
  }

  const semanticResult = runSemanticTypecheck(ts, wrappedCode, headerLineCount);
  if (semanticResult.isOk()) return semanticResult.value;

  if (!warnedSemanticFallback) {
    warnedSemanticFallback = true;
    console.warn(
      `[executor] TypeScript semantic typecheck unavailable, falling back to syntax-only checks: ${semanticResult.error.message}`,
    );
  }

  return runSyntaxOnlyTypecheck(ts, wrappedCode, headerLineCount);
}
