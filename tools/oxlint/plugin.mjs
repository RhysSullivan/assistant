import { definePlugin } from "@oxlint/plugins";

import noCrossWorkspaceRelativeImports from "./rules/no-cross-workspace-relative-imports.mjs";
import noNodeFsWithEffectImports from "./rules/no-node-fs-with-effect-imports.mjs";
import noRawEffectFailErrors from "./rules/no-raw-effect-fail-errors.mjs";
import noYieldEffectFail from "./rules/no-yield-effect-fail.mjs";
import noWorkspaceSrcImports from "./rules/no-workspace-src-imports.mjs";

export default definePlugin({
  meta: {
    name: "oxlint-plugin-executor-monorepo",
  },
  rules: {
    "no-cross-workspace-relative-imports": noCrossWorkspaceRelativeImports,
    "no-node-fs-with-effect-imports": noNodeFsWithEffectImports,
    "no-raw-effect-fail-errors": noRawEffectFailErrors,
    "no-yield-effect-fail": noYieldEffectFail,
    "no-workspace-src-imports": noWorkspaceSrcImports,
  },
});
