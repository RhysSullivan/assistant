#!/usr/bin/env bun
/**
 * Post-build step: wraps the Astro Cloudflare adapter output with
 * otel-cf-workers + Sentry Cloudflare instrumentation.
 *
 * The Astro adapter emits dist/server/entry.mjs as the worker entry (per
 * dist/server/wrangler.json -> "main"). There is no Astro hook to substitute
 * that entry, so we:
 *
 *   1. Rename dist/server/entry.mjs -> dist/server/astro-entry.mjs
 *   2. Write a shim source file that imports ./astro-entry.mjs and wraps its
 *      default export with `instrument()` + `Sentry.withSentry()` (mirroring
 *      apps/cloud/src/server.ts).
 *   3. Bundle the shim back to dist/server/entry.mjs with @microlabs/otel-cf-workers
 *      and @sentry/cloudflare inlined (Astro's Vite pass is done, so anything
 *      we add here has to ship as a self-contained bundle).
 *   4. Patch dist/server/wrangler.json to ensure `nodejs_compat` is set.
 *
 * We deliberately do NOT use `instrumentDO` / `instrumentDurableObjectWithSentry`
 * because marketing has no Durable Objects and those wrappers have known
 * this-binding issues on WorkerTransport anyway.
 */

import { existsSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const marketingRoot = resolve(__dirname, "..");
const serverDir = resolve(marketingRoot, "dist", "server");
const entryPath = join(serverDir, "entry.mjs");
const astroEntryPath = join(serverDir, "astro-entry.mjs");
const wranglerJsonPath = join(serverDir, "wrangler.json");

// The shim lives under apps/marketing/ (not dist/server/) so npm resolution
// finds node_modules when Bun bundles. We relocate the bundled output into
// dist/server/entry.mjs afterward.
const shimSourcePath = join(marketingRoot, "__otel-shim__.mjs");
// Relative path from the shim source to the renamed Astro entry. After the
// bundle lands in dist/server/ this will be rewritten to "./astro-entry.mjs".
const astroEntryImportSpec = "./" + relative(marketingRoot, astroEntryPath).replace(/\\/g, "/");

if (!existsSync(entryPath)) {
  throw new Error(
    `Expected Astro adapter output at ${entryPath}. Run \`astro build\` first.`,
  );
}

// 1. Rename Astro's entry so the shim can import it by relative path.
if (existsSync(astroEntryPath)) {
  await rm(astroEntryPath);
}
await rename(entryPath, astroEntryPath);

// 2. Write the shim source. It reads config from process.env at request time
//    (Cloudflare surfaces secrets there when nodejs_compat is on). We mirror
//    apps/cloud/src/server.ts's sentryOptions shape verbatim.
const shimSource = /* js */ `import * as Sentry from "@sentry/cloudflare";
import { instrument } from "@microlabs/otel-cf-workers";
import astroHandler from ${JSON.stringify(astroEntryImportSpec)};

const readEnv = (key) => {
  const value = globalThis.process?.env?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

// otel-cf-workers owns the global TracerProvider. Sentry's OTEL compat shim
// registers a ProxyTracerProvider of its own, which prevents otel-cf-workers
// from finding its WorkerTracer and breaks the whole request path with
// "global tracer is not of type WorkerTracer". Hence \`skipOpenTelemetrySetup\`.
const sentryOptions = (_env) => ({
  dsn: readEnv("SENTRY_DSN"),
  tracesSampleRate: 0,
  enableLogs: true,
  sendDefaultPii: true,
  skipOpenTelemetrySetup: true,
});

const otelConfig = {
  service: { name: "executor-marketing" },
  exporter: {
    url: "https://api.axiom.co/v1/traces",
    headers: {
      Authorization: \`Bearer \${readEnv("AXIOM_TOKEN") ?? ""}\`,
      "X-Axiom-Dataset": readEnv("AXIOM_DATASET") ?? "executor-cloud",
    },
  },
};

const baseHandler = astroHandler ?? {};
if (typeof baseHandler.fetch !== "function") {
  throw new Error(
    "Astro adapter default export is missing a fetch handler; the adapter layout changed?",
  );
}

// Preserve every top-level handler Astro emitted (fetch, scheduled, queue, etc.)
// but route fetch through otel-cf-workers' \`instrument()\`.
const instrumentedFetch = instrument(
  { fetch: baseHandler.fetch.bind(baseHandler) },
  otelConfig,
).fetch;

const wrapped = {
  ...baseHandler,
  fetch: instrumentedFetch,
};

export default Sentry.withSentry(sentryOptions, wrapped);
`;

await writeFile(shimSourcePath, shimSource, "utf8");

// 3. Bundle the shim. The renamed Astro entry stays external (kept as a
//    relative import) so its own relative chunks and `cloudflare:workers`
//    imports resolve the way Astro emitted them. Everything else (Sentry,
//    otel-cf-workers, their transitive deps) gets inlined because we're
//    running AFTER Astro's Vite pass.
//
//    We bundle from apps/marketing/ (not from dist/server/) so npm resolution
//    finds node_modules. The output then gets moved into dist/server/ and the
//    astro-entry import path gets rewritten to a server-dir-relative one.
let bundled: string;
try {
  const result = await Bun.build({
    entrypoints: [shimSourcePath],
    target: "browser",
    format: "esm",
    conditions: ["workerd", "worker", "browser"],
    minify: false,
    external: ["cloudflare:*", "node:*", astroEntryImportSpec],
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    throw new Error("Failed to bundle OTEL/Sentry shim");
  }
  if (result.outputs.length === 0) {
    throw new Error("Bun.build produced no outputs");
  }
  bundled = await result.outputs[0]!.text();
} finally {
  // Always clean up the shim source regardless of build success so it doesn't
  // clutter the marketing app root.
  await rm(shimSourcePath, { force: true });
}

// Rewrite the import path from the shim-relative spec to a
// server-dir-relative one so Cloudflare can resolve it once the bundle moves
// into dist/server/.
const rewritten = bundled.replaceAll(
  JSON.stringify(astroEntryImportSpec),
  JSON.stringify("./astro-entry.mjs"),
);
if (!rewritten.includes("./astro-entry.mjs")) {
  throw new Error(
    "Bundled shim does not reference astro-entry.mjs — bundler may have inlined it unexpectedly.",
  );
}

await writeFile(entryPath, rewritten, "utf8");

// 4. Patch wrangler.json — ensure nodejs_compat is present (defensively; the
//    Astro adapter already sets it at the time of writing, but that's not
//    guaranteed across versions).
const wranglerRaw = await readFile(wranglerJsonPath, "utf8");
const wrangler = JSON.parse(wranglerRaw) as {
  compatibility_flags?: string[];
  [key: string]: unknown;
};
const flags = new Set<string>(wrangler.compatibility_flags ?? []);
flags.add("nodejs_compat");
wrangler.compatibility_flags = Array.from(flags);
await writeFile(wranglerJsonPath, JSON.stringify(wrangler), "utf8");

console.log(
  `[wrap-worker] wrapped ${entryPath} with otel-cf-workers + Sentry; compatibility_flags=${wrangler.compatibility_flags.join(",")}`,
);
