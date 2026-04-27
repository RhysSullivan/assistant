import { packageConfigWithExternal } from "../../tsup.shared.config";

export default packageConfigWithExternal(
  { index: "src/index.ts", "testing/conformance": "src/testing/conformance.ts", "testing/memory": "src/testing/memory.ts" },
  ["vitest"],
);
