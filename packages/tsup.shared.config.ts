import { defineConfig, type Options } from "tsup";

const baseExternal = [/^@executor\//, /^effect/, /^@effect\//] as const;

export const packageConfig = (entry: Options["entry"], external: Options["external"] = baseExternal) =>
  defineConfig({ entry, format: ["esm"], dts: false, sourcemap: true, clean: true, external });

export const packageConfigWithExternal = (entry: Options["entry"], extra: Options["external"]) =>
  packageConfig(entry, [...baseExternal, ...(extra ?? [])]);
