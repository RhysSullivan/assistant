import { defineConfig } from "drizzle-kit";

const sanitizePostgresUrl = (value: string): string => {
  try {
    const parsed = new URL(value);

    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      return value;
    }

    parsed.searchParams.delete("sslrootcert");
    parsed.searchParams.delete("sslcert");
    parsed.searchParams.delete("sslkey");
    parsed.searchParams.delete("sslcrl");

    return parsed.toString();
  } catch {
    return value;
  }
};

const databaseUrl = sanitizePostgresUrl(
  process.env.DATABASE_URL ?? "postgres://localhost:5432/executor_v2",
);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
