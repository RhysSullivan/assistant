import path from "node:path";
import { defineRule } from "@oxlint/plugins";

const MANUAL_OPENAPI_RULE_ALLOWED_PATH_SEGMENTS = [
  `${path.sep}packages${path.sep}sources${path.sep}openapi${path.sep}`,
  `${path.sep}packages${path.sep}platform${path.sep}sdk${path.sep}src${path.sep}runtime${path.sep}sources${path.sep}source-adapter-fixture-matrix.test.ts`,
  `${path.sep}packages${path.sep}platform${path.sep}sdk${path.sep}src${path.sep}runtime${path.sep}sources${path.sep}source-discovery.test.ts`,
];

const OPENAPI_MARKER_KEYS = new Set(["openapi", "swagger"]);
const OPENAPI_SHAPE_KEYS = new Set([
  "components",
  "info",
  "paths",
  "responses",
  "security",
  "servers",
  "tags",
]);

const isTestLikeFile = (filename) =>
  filename.includes(".test.")
  || filename.includes(".spec.")
  || filename.endsWith(".test.ts")
  || filename.endsWith(".test.tsx")
  || filename.endsWith(".spec.ts")
  || filename.endsWith(".spec.tsx");

const isAllowedFile = (filename) =>
  MANUAL_OPENAPI_RULE_ALLOWED_PATH_SEGMENTS.some((segment) =>
    filename.includes(segment)
  );

const readPropertyKey = (node) => {
  if (!node || node.type !== "Property" || node.computed) {
    return null;
  }

  const key = node.key;
  if (!key) {
    return null;
  }

  if (key.type === "Identifier") {
    return key.name;
  }

  if (key.type === "Literal" && typeof key.value === "string") {
    return key.value;
  }

  return null;
};

const objectExpressionKeys = (node) => {
  if (!node || node.type !== "ObjectExpression") {
    return [];
  }

  return node.properties
    .map(readPropertyKey)
    .filter((key) => typeof key === "string");
};

const looksLikeOpenApiDocument = (node) => {
  if (!node || node.type !== "ObjectExpression") {
    return false;
  }

  const keys = new Set(objectExpressionKeys(node));
  const hasOpenApiMarker = [...OPENAPI_MARKER_KEYS].some((key) => keys.has(key));
  const hasOpenApiShape = [...OPENAPI_SHAPE_KEYS].some((key) => keys.has(key));

  return hasOpenApiMarker && hasOpenApiShape;
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow hand-authored inline OpenAPI documents in normal test files.",
      recommended: true,
    },
    messages: {
      noManualOpenApiDocuments:
        "Do not hand-author inline OpenAPI documents here. Use Effect's HttpApi/OpenApi builders, such as `OpenApi.fromApi(...)`, instead. Raw OpenAPI fixtures should live only in dedicated OpenAPI parser/import tests.",
    },
  },
  create(context) {
    if (!isTestLikeFile(context.filename) || isAllowedFile(context.filename)) {
      return {};
    }

    return {
      ObjectExpression(node) {
        if (!looksLikeOpenApiDocument(node)) {
          return;
        }

        context.report({
          node,
          messageId: "noManualOpenApiDocuments",
        });
      },
    };
  },
});
