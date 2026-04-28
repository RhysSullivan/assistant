import { noInlineObjectTypeAssertion } from "./rules/no-inline-object-type-assertion.js";
import { noIfInTests } from "./rules/no-if-in-tests.js";
import { noInstanceofTaggedError } from "./rules/no-instanceof-tagged-error.js";
import { noManualTagCheck } from "./rules/no-manual-tag-check.js";
import { noPromiseClientSurface } from "./rules/no-promise-client-surface.js";
import { noRawErrorThrow } from "./rules/no-raw-error-throw.js";
import { noRedundantErrorFactory } from "./rules/no-redundant-error-factory.js";
import { noUnknownShapeProbing } from "./rules/no-unknown-shape-probing.js";
import { noVitestImport } from "./rules/no-vitest-import.js";

export default {
  meta: {
    name: "executor",
  },
  rules: {
    "no-inline-object-type-assertion": noInlineObjectTypeAssertion,
    "no-if-in-tests": noIfInTests,
    "no-instanceof-tagged-error": noInstanceofTaggedError,
    "no-manual-tag-check": noManualTagCheck,
    "no-promise-client-surface": noPromiseClientSurface,
    "no-raw-error-throw": noRawErrorThrow,
    "no-redundant-error-factory": noRedundantErrorFactory,
    "no-unknown-shape-probing": noUnknownShapeProbing,
    "no-vitest-import": noVitestImport,
  },
};
