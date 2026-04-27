import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig, type UserConfig } from "vitest/config";

export const cloudflarePackageTestConfig = (
  configPath: string,
  test: NonNullable<UserConfig["test"]> = {},
) => defineConfig({ plugins: [cloudflareTest({ wrangler: { configPath } })], test });
