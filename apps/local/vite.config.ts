import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rootPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string; homepage?: string; repository?: string | { url?: string } };

const cliPackage = JSON.parse(
  readFileSync(new URL("../cli/package.json", import.meta.url), "utf8"),
) as { version?: string };

const repositoryUrl =
  typeof rootPackage.repository === "string"
    ? rootPackage.repository
    : rootPackage.repository?.url;

const EXECUTOR_VERSION = cliPackage.version ?? rootPackage.version;
const EXECUTOR_GITHUB_URL = (rootPackage.homepage ?? repositoryUrl ?? "https://github.com/RhysSullivan/executor")
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(EXECUTOR_VERSION),
    "import.meta.env.VITE_GITHUB_URL": JSON.stringify(EXECUTOR_GITHUB_URL),
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
  server: {
    port: parseInt(process.env.PORT ?? "5173", 10),
    host: "127.0.0.1",
  },
  ssr: {
    external: true,
  },
  optimizeDeps: {
    rolldownOptions: {
      external: [/^@napi-rs\//],
    },
  },
  plugins: [
    tailwindcss(),
    tanstackStart({
      spa: { enabled: true },
    }),
    ...react(),
  ],
});
