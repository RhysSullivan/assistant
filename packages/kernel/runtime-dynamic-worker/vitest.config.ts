import { cloudflarePackageTestConfig } from "../../vitest.cloudflare.config";

export default cloudflarePackageTestConfig("./wrangler.jsonc", { include: ["src/**/*.test.ts"] });
