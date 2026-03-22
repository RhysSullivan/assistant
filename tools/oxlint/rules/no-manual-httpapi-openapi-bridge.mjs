import { readFileSync } from "node:fs";
import { defineRule } from "@oxlint/plugins";

const isTestLikeFile = (filename) =>
  filename.includes(".test.")
  || filename.includes(".spec.")
  || filename.endsWith(".test.ts")
  || filename.endsWith(".test.tsx")
  || filename.endsWith(".spec.ts")
  || filename.endsWith(".spec.tsx");

const readsLikeOpenApiHttpApiTest = (filename) => {
  try {
    const sourceText = readFileSync(filename, "utf8");
    return sourceText.includes("HttpApiBuilder.middlewareOpenApi(")
      || sourceText.includes("OpenApi.fromApi(");
  } catch {
    return false;
  }
};

const isHttpApiBuilderCall = (node, methodName) =>
  node?.type === "CallExpression"
  && node.callee?.type === "MemberExpression"
  && node.callee.computed === false
  && node.callee.object?.type === "Identifier"
  && node.callee.object.name === "HttpApiBuilder"
  && node.callee.property?.type === "Identifier"
  && node.callee.property.name === methodName;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow manual Node/Web bridges around Effect HttpApi when serving OpenAPI test servers.",
      recommended: true,
    },
    messages: {
      noManualHttpApiOpenApiBridge:
        "Do not serve OpenAPI test servers by manually bridging `HttpApiBuilder.toWebHandler(...)` to Node HTTP. Use `@executor/effect-test-utils` (`startOpenApiTestServer` / `makeOpenApiTestServer`) instead.",
    },
  },
  create(context) {
    if (
      !isTestLikeFile(context.filename)
      || !readsLikeOpenApiHttpApiTest(context.filename)
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        if (!isHttpApiBuilderCall(node, "toWebHandler")) {
          return;
        }

        context.report({
          node,
          messageId: "noManualHttpApiOpenApiBridge",
        });
      },
    };
  },
});
