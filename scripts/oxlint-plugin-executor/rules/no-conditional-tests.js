import { getCallName } from "../utils.js";
import { isTestLike } from "../utils.js";
import { unwrapExpression } from "../utils.js";

const testRegistrars = new Set(["it", "test"]);

const isFunction = (node) =>
  node?.type === "ArrowFunctionExpression" ||
  node?.type === "FunctionExpression" ||
  node?.type === "FunctionDeclaration";

const isTestRegistrationCall = (node) => {
  const callee = unwrapExpression(node.callee);
  if (callee?.type === "Identifier") return testRegistrars.has(callee.name);
  if (callee?.type !== "MemberExpression") return false;

  const object = unwrapExpression(callee.object);
  return object?.type === "Identifier" && testRegistrars.has(object.name);
};

export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow conditional expect calls inside tests.",
    },
  },
  create(context) {
    if (!isTestLike(context.filename)) return {};

    const testCallbacks = new WeakSet();
    let testDepth = 0;
    let conditionalDepth = 0;

    const enterFunction = (node) => {
      if (testCallbacks.has(node)) testDepth++;
    };
    const exitFunction = (node) => {
      if (testCallbacks.has(node)) testDepth--;
    };
    const enterConditional = () => {
      if (testDepth > 0) conditionalDepth++;
    };
    const exitConditional = () => {
      if (testDepth > 0) conditionalDepth--;
    };

    return {
      CallExpression(node) {
        if (isTestRegistrationCall(node)) {
          const callback = node.arguments.find(isFunction);
          if (callback) testCallbacks.add(callback);
        }

        if (testDepth === 0 || conditionalDepth === 0) return;
        const name = getCallName(node.callee);
        if (name !== "expect") return;
        context.report({
          node,
          message:
            "Avoid conditional expect calls; split the test or assert both branches explicitly. Skill: wrdn-effect-vitest-tests.",
        });
      },
      FunctionDeclaration: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      FunctionExpression: enterFunction,
      "FunctionExpression:exit": exitFunction,
      ArrowFunctionExpression: enterFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      IfStatement: enterConditional,
      "IfStatement:exit": exitConditional,
      ConditionalExpression: enterConditional,
      "ConditionalExpression:exit": exitConditional,
      LogicalExpression: enterConditional,
      "LogicalExpression:exit": exitConditional,
      SwitchCase: enterConditional,
      "SwitchCase:exit": exitConditional,
    };
  },
};
