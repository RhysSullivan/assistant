import { cloudflarePackageTestConfig } from "../../packages/vitest.cloudflare.config";

export default cloudflarePackageTestConfig("./wrangler.test.jsonc", {
  include: ["src/**/*.test.ts"],
  exclude: ["src/**/*.node.test.ts", "**/node_modules/**"],
  globalSetup: ["./scripts/test-globalsetup.ts"],
  // postgres.js's Cloudflare polyfill leaves benign writer.ready rejections as sockets close.
  onUnhandledError: (error) =>
    !(error && (error as Error).message === "Stream was cancelled."),
});
