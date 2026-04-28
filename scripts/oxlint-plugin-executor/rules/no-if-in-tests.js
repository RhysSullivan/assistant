const message =
  "Do not use if statements in tests. Prefer Effect branching/matching helpers and effect/vitest assertions.";

export const noIfInTests = {
  meta: {
    type: "problem",
    docs: {
      description: message,
    },
    messages: {
      noIfInTests: message,
    },
    schema: [],
  },
  create(context) {
    return {
      IfStatement(node) {
        context.report({ node, messageId: "noIfInTests" });
      },
    };
  },
};
