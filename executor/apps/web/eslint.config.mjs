import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "next-env.d.ts",
    ".next/**",
    "build/**",
    "dist/**",
  ]),
]);

export default eslintConfig;
