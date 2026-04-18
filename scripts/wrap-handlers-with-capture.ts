#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// One-shot script that wraps each `HttpApiBuilder.group(...).handle(name, fn)`
// body with `capture(...)` from `@executor/api`. Replaces the Proxy-based
// `withCapture` service wrapping with per-handler explicit translation.
//
// Run once after removing `withCapture` / `Captured<T>` and flipping service
// tags back to raw shapes. This script is idempotent — it skips handlers
// that already have `capture(...)` around their body.
// ---------------------------------------------------------------------------

import { readFile, writeFile } from "node:fs/promises";

const FILES = [
  "packages/core/api/src/handlers/tools.ts",
  "packages/core/api/src/handlers/sources.ts",
  "packages/core/api/src/handlers/secrets.ts",
  "packages/core/api/src/handlers/executions.ts",
  "packages/core/api/src/handlers/scope.ts",
  "packages/plugins/mcp/src/api/handlers.ts",
  "packages/plugins/openapi/src/api/handlers.ts",
  "packages/plugins/graphql/src/api/handlers.ts",
  "packages/plugins/google-discovery/src/api/handlers.ts",
  "packages/plugins/onepassword/src/api/handlers.ts",
];

// Matches `.handle("name", (arg) =>\n  [optional comment lines]  Effect.gen(function* () {
//   ...body...
//   })` — where the closing `}` sits at the same indent as `Effect.gen`.
//
// Groups:
//   1. the `=>` + trailing whitespace / newline
//   2. optional leading comments + whitespace before Effect.gen
//   3. the indent of the Effect.gen line (used to find the matching close)
//   4. the body of Effect.gen (non-greedy, up to matching close)
const HANDLER_BODY = /(=>)\s*\n((?:[ \t]*\/\/[^\n]*\n)*)([ \t]+)Effect\.gen\(function\* \(\) \{([\s\S]*?)\n\3\}\)/g;

function wrapHandlerBodies(src: string): { next: string; count: number } {
  let count = 0;
  const next = src.replace(HANDLER_BODY, (match, arrow, leading, indent, body) => {
    // Skip if already wrapped — a previous `capture(` sits immediately before
    // this Effect.gen token on the same line.
    const idx = src.indexOf(match);
    const preceding = src.slice(Math.max(0, idx - 20), idx + arrow.length);
    if (preceding.includes("capture(")) return match;
    count++;
    return `${arrow}\n${leading}${indent}capture(Effect.gen(function* () {${body}\n${indent}}))`;
  });
  return { next, count };
}

function ensureCaptureImport(src: string): string {
  // Already imports `capture`?
  if (/from\s+["']@executor\/api["'][^;]*\bcapture\b/.test(src)) return src;

  // Has an existing `@executor/api` import — extend it.
  const named = /import\s*\{([^}]*)\}\s*from\s*["']@executor\/api["'];?/;
  if (named.test(src)) {
    return src.replace(named, (_, inner) => {
      const names = inner
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (names.includes("capture")) return _;
      names.push("capture");
      names.sort((a: string, b: string) => {
        // `type ` imports sort after value imports
        const at = a.startsWith("type ");
        const bt = b.startsWith("type ");
        if (at !== bt) return at ? 1 : -1;
        return a.localeCompare(b);
      });
      return `import { ${names.join(", ")} } from "@executor/api";`;
    });
  }

  // No existing import — add a fresh one after the last import line.
  const importLines = [...src.matchAll(/^import [^\n]+\n/gm)];
  if (importLines.length === 0) {
    return `import { capture } from "@executor/api";\n\n${src}`;
  }
  const last = importLines[importLines.length - 1];
  const insertAt = last.index! + last[0].length;
  return (
    src.slice(0, insertAt) +
    `import { capture } from "@executor/api";\n` +
    src.slice(insertAt)
  );
}

async function processFile(path: string): Promise<{ path: string; handlers: number }> {
  let src: string;
  try {
    src = await readFile(path, "utf8");
  } catch {
    return { path, handlers: -1 }; // file doesn't exist; skip
  }

  const { next: wrapped, count } = wrapHandlerBodies(src);
  if (count === 0) return { path, handlers: 0 };

  const final = ensureCaptureImport(wrapped);
  await writeFile(path, final, "utf8");
  return { path, handlers: count };
}

const results = await Promise.all(FILES.map(processFile));
for (const { path, handlers } of results) {
  if (handlers < 0) console.log(`skipped (not found): ${path}`);
  else console.log(`${handlers.toString().padStart(3)} handlers: ${path}`);
}
const total = results.reduce((n, r) => n + Math.max(0, r.handlers), 0);
console.log(`\n${total} handler bodies wrapped.`);
