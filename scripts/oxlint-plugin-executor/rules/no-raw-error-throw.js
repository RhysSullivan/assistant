import { isIdentifier } from "../utils/ast.js";

const message =
  "Do not throw raw Error objects in Effect code. Return Effect.fail with a tagged error or assert directly in tests.";

const isNewError = (node) => node?.type === "NewExpression" && isIdentifier(node.callee, "Error");

export const noRawErrorThrow = {
  meta: {
    type: "problem",
    docs: {
      description: message,
    },
    messages: {
      noRawErrorThrow: message,
    },
    schema: [],
  },
  create(context) {
    return {
      ThrowStatement(node) {
        if (isNewError(node.argument)) {
          context.report({ node, messageId: "noRawErrorThrow" });
        }
      },
    };
  },
};
