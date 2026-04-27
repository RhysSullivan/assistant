import { defineConfig, type UserConfig } from "vitest/config";

export const packageTestConfig = (test: NonNullable<UserConfig["test"]> = {}) =>
  defineConfig({ test: { include: ["src/**/*.test.ts"], ...test } });
