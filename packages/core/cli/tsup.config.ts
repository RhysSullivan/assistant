import { packageConfigWithExternal } from "../../tsup.shared.config";

export default packageConfigWithExternal({ index: "src/index.ts" }, ["commander", "jiti"]);
