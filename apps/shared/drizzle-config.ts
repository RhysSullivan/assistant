import { defineConfig } from "drizzle-kit";

const withSslMode = (url: string): string =>
  url.includes("127.0.0.1") || url.includes("localhost") || /[?&]sslmode=/.test(url)
    ? url
    : url + (url.includes("?") ? "&" : "?") + "sslmode=require";

export const localDrizzleConfig = () =>
  defineConfig({ schema: "./src/server/executor-schema.ts", out: "./drizzle", dialect: "sqlite" });

export const cloudDrizzleConfig = () =>
  defineConfig({
    schema: ["./src/services/schema.ts", "./src/services/executor-schema.ts"],
    out: "./drizzle",
    dialect: "postgresql",
    dbCredentials: {
      url: withSslMode(process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5433/postgres"),
    },
  });
