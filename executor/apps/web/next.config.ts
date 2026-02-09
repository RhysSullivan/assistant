import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Required for Turbopack (Next.js 16 default) – even if empty,
  // it silences the "no turbopack config" warning.
  turbopack: {},
  // Transpile workspace packages so Next.js resolves their raw .ts sources
  // when they appear in the type graph (e.g. convex/database.ts imports @executor/contracts).
  transpilePackages: ["@executor/contracts"],
};

export default nextConfig;
