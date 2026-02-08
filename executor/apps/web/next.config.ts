import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Turbopack (Next.js 16 default) – even if empty,
  // it silences the "no turbopack config" warning.
  turbopack: {},
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:4001/api/:path*",
      },
    ];
  },
};

export default nextConfig;
