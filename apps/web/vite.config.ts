import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import devServer from "@hono/vite-dev-server";

export default defineConfig({
  root: "src",
  plugins: [
    tailwindcss(),
    react(),
    devServer({
      entry: "src/dev.ts",
      exclude: [
        // Only let /v1 and /mcp requests reach the API handler
        /^\/(?!(v1|mcp)(\/|$))/,
        /^\/(src|node_modules|@vite|@id|@react-refresh)/,
        /\.(css|ts|tsx|js|jsx|svg|png|jpg|gif|ico|woff2?|json|map)(\?.*)?$/,
      ],
      injectClientScript: false,
    }),
  ],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 8788,
  },
});
