import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDir = dirname(fileURLToPath(import.meta.url));

const controlPlaneUpstream =
  process.env.CONTROL_PLANE_UPSTREAM_URL ?? "http://127.0.0.1:8787";

const nextConfig: NextConfig = {
  outputFileTracingRoot: resolve(appDir, "../.."),
  async rewrites() {
    return [
      {
        source: "/api/control-plane/:path*",
        destination: `${controlPlaneUpstream}/:path*`,
      },
    ];
  },
};

export default nextConfig;
