import { isIdentifier, isStringLiteral } from "../utils/ast.js";

const message =
  "Do not inspect _tag manually. Use Effect.catchTag, Effect.catchTags, Predicate.isTagged, or another Effect tagged-error API.";

const isTagProperty = (node) =>
  isIdentifier(node, "_tag") || (isStringLiteral(node) && node.value === "_tag");

export const noManualTagCheck = {
  meta: {
    type: "problem",
    docs: {
      description: message,
    },
    messages: {
      noManualTagCheck: message,
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (isTagProperty(node.property)) {
          context.report({ node, messageId: "noManualTagCheck" });
        }
      },
    };
  },
};
