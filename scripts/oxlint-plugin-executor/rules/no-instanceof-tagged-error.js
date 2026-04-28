import { isIdentifier, nodeName } from "../utils/ast.js";

const message =
  "Do not use instanceof for tagged errors. Use Effect.catchTag, Effect.catchTags, or a _tag-based guard.";

const looksLikeTaggedErrorName = (name) =>
  typeof name === "string" && name !== "Error" && name.endsWith("Error");

export const noInstanceofTaggedError = {
  meta: {
    type: "problem",
    docs: {
      description: message,
    },
    messages: {
      noInstanceofTaggedError: message,
    },
    schema: [],
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (node.operator !== "instanceof") return;
        const rightName = nodeName(node.right);
        if (isIdentifier(node.right) && looksLikeTaggedErrorName(rightName)) {
          context.report({ node, messageId: "noInstanceofTaggedError" });
        }
      },
    };
  },
};
