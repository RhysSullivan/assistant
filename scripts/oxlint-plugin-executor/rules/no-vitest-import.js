const message =
  "Do not import from vitest directly. Use @effect/vitest and Effect's vitest helper modules, for example @effect/vitest/utils.";

export const noVitestImport = {
  meta: {
    type: "problem",
    docs: {
      description: message,
    },
    messages: {
      noVitestImport: message,
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source?.value === "vitest") {
          context.report({ node, messageId: "noVitestImport" });
        }
      },
    };
  },
};
