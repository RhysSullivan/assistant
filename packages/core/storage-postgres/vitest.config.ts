import { packageTestConfig } from "../../vitest.shared.config";

export default packageTestConfig({
  passWithNoTests: true,
  hookTimeout: 30_000,
  globalSetup: ["./scripts/test-globalsetup.ts"],
});
