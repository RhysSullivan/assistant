#!/usr/bin/env bun

export {};

const INTEGRATION_TESTS = new Set([
  "packages/core/src/openapi/real-specs.test.ts",
]);

type SuiteMode = "fast" | "integration" | "e2e" | "all";

function normalizeMode(raw: string | undefined): SuiteMode {
  if (raw === "integration" || raw === "e2e" || raw === "all") {
    return raw;
  }
  return "fast";
}

function isE2eTest(filePath: string): boolean {
  return filePath.endsWith(".e2e.test.ts");
}

async function discoverAllTestFiles(): Promise<string[]> {
  const files = new Set<string>();
  const roots = ["apps", "packages", "scripts"];

  for (const root of roots) {
    const glob = new Bun.Glob(`${root}/**/*.test.ts`);
    for await (const match of glob.scan({ cwd: process.cwd() })) {
      files.add(match);
    }
  }

  return [...files].sort();
}

function selectTests(mode: SuiteMode, allTests: string[]): string[] {
  if (mode === "all") {
    return allTests;
  }

  if (mode === "integration") {
    return allTests.filter((filePath) => INTEGRATION_TESTS.has(filePath));
  }

  if (mode === "e2e") {
    return allTests.filter(isE2eTest);
  }

  return allTests.filter((filePath) => !isE2eTest(filePath) && !INTEGRATION_TESTS.has(filePath));
}

async function main(): Promise<void> {
  const mode = normalizeMode(process.argv[2]);
  const rawArgs = process.argv.slice(3);
  const listOnly = rawArgs.includes("--list");
  const passthroughArgs = rawArgs.filter((arg) => arg !== "--list");

  const allTests = await discoverAllTestFiles();
  const selectedTests = selectTests(mode, allTests);

  if (selectedTests.length === 0) {
    console.error(`[test-suite] No tests selected for mode '${mode}'.`);
    process.exit(1);
  }

  console.log(`[test-suite] mode=${mode} files=${selectedTests.length}`);

  if (listOnly) {
    for (const filePath of selectedTests) {
      console.log(filePath);
    }
    return;
  }

  const child = Bun.spawn([
    "bun",
    "test",
    ...selectedTests,
    ...passthroughArgs,
  ], {
    cwd: process.cwd(),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });

  const exitCode = await child.exited;
  process.exit(exitCode);
}

await main();
