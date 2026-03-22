import { definePlugin } from "@oxlint/plugins";

import noCrossWorkspaceRelativeImports from "./rules/no-cross-workspace-relative-imports.mjs";
import noAsyncEffectVitestTests from "./rules/no-async-effect-vitest-tests.mjs";
import noDirectEffectTagRead from "./rules/no-direct-effect-tag-read.mjs";
import noEffectRunInEffectVitestTests from "./rules/no-effect-run-in-effect-vitest-tests.mjs";
import noManualHttpApiOpenApiBridge from "./rules/no-manual-httpapi-openapi-bridge.mjs";
import noManualOpenApiDocuments from "./rules/no-manual-openapi-documents.mjs";
import noNodeFsWithEffectImports from "./rules/no-node-fs-with-effect-imports.mjs";
import noRawEffectFailErrors from "./rules/no-raw-effect-fail-errors.mjs";
import noYieldEffectFail from "./rules/no-yield-effect-fail.mjs";
import noWorkspaceSrcImports from "./rules/no-workspace-src-imports.mjs";

export default definePlugin({
  meta: {
    name: "oxlint-plugin-executor-monorepo",
  },
  rules: {
    "no-async-effect-vitest-tests": noAsyncEffectVitestTests,
    "no-cross-workspace-relative-imports": noCrossWorkspaceRelativeImports,
    "no-direct-effect-tag-read": noDirectEffectTagRead,
    "no-effect-run-in-effect-vitest-tests": noEffectRunInEffectVitestTests,
    "no-manual-httpapi-openapi-bridge": noManualHttpApiOpenApiBridge,
    "no-manual-openapi-documents": noManualOpenApiDocuments,
    "no-node-fs-with-effect-imports": noNodeFsWithEffectImports,
    "no-raw-effect-fail-errors": noRawEffectFailErrors,
    "no-yield-effect-fail": noYieldEffectFail,
    "no-workspace-src-imports": noWorkspaceSrcImports,
  },
});
