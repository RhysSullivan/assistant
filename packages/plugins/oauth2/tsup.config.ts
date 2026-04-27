import { packageConfig } from "../../tsup.shared.config";

export default packageConfig({ index: "src/index.ts", http: "src/http.ts", react: "src/react.ts" });
