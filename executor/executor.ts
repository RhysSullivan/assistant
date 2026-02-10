#!/usr/bin/env bun

import { startMcpGateway } from "./mcp-gateway";
import { managedRuntimeDiagnostics, runManagedBackend } from "./lib/managed_runtime";

function printHelp(): void {
  console.log(`Executor CLI

Usage:
  executor doctor
  executor up [backend-args]
  executor backend <args>
  executor gateway [--port <number>]

Commands:
  doctor        Bootstrap and verify managed Convex backend runtime
  up            Run managed Convex backend directly (no Bun/Node/Convex install)
  backend       Pass through arguments to managed convex-local-backend binary
  gateway       Start Executor MCP gateway (default port: 5313)
`);
}

function parsePort(args: string[]): number | undefined {
  const flagIndex = args.findIndex((arg) => arg === "--port");
  if (flagIndex === -1) {
    return undefined;
  }

  const raw = args[flagIndex + 1];
  if (!raw) {
    throw new Error("Missing value for --port");
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }

  return port;
}

async function run(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "doctor") {
    const info = await managedRuntimeDiagnostics();
    console.log("Managed runtime ready");
    console.log(`  root: ${info.rootDir}`);
    console.log(`  backend: ${info.backendVersion} (${info.backendBinary})`);
    console.log(`  convex URL: ${info.convexUrl}`);
    console.log(`  convex site: ${info.convexSiteUrl}`);
    console.log(`  config: ${info.configPath}`);
    return;
  }

  if (command === "up") {
    const exitCode = await runManagedBackend(rest);
    process.exit(exitCode);
  }

  if (command === "backend" || command === "convex") {
    if (rest.length === 0) {
      throw new Error("Missing backend arguments. Example: executor backend --help");
    }
    const exitCode = await runManagedBackend(rest);
    process.exit(exitCode);
  }

  if (command === "gateway") {
    const port = parsePort(rest);
    startMcpGateway(port);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`executor: ${message}`);
  process.exit(1);
}
