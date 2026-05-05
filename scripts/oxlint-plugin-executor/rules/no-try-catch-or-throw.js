const tryCatchMessage =
  "Do not use try/catch blocks. Model failures with Effect instead. Skill: wrdn-effect-typed-errors; React useAtomSet mutation handlers use wrdn-effect-promise-exit.";
const throwMessage =
  "Do not throw errors. Model failures with Effect.fail or typed error values instead. Skill: wrdn-effect-typed-errors.";

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow try/catch blocks and throw statements.",
    },
  },
  create(context) {
    return {
      TryStatement(node) {
        context.report({ node, message: tryCatchMessage });
      },
      ThrowStatement(node) {
        context.report({ node, message: throwMessage });
      },
    };
  },
};
