import { packageConfig } from "./tsup.shared.config";

export default packageConfig({ index: "src/promise.ts", core: "src/index.ts" });
