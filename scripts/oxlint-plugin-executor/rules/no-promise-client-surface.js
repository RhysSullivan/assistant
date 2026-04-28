import { containsPromiseType, nodeName } from "../utils/ast.js";

const message =
  "Do not expose Promise-shaped client surfaces. Wrap third-party SDK promises at the adapter boundary and expose Effect methods.";

const isExported = (node) => node?.parent?.type === "ExportNamedDeclaration";

const isClientInterface = (node) => {
  const name = nodeName(node.id);
  return typeof name === "string" &&
    (name.endsWith("Client") || (isExported(node) && name.endsWith("Sdk")));
};

const methodReturnsPromise = (node) => containsPromiseType(node.returnType);

const propertyReturnsPromise = (node) => containsPromiseType(node.typeAnnotation);

export const noPromiseClientSurface = {
  meta: {
    type: "problem",
    docs: {
      description: message,
    },
    messages: {
      noPromiseClientSurface: message,
    },
    schema: [],
  },
  create(context) {
    return {
      TSInterfaceDeclaration(node) {
        if (!isClientInterface(node)) return;
        for (const member of node.body?.body ?? []) {
          if (
            (member.type === "TSMethodSignature" && methodReturnsPromise(member)) ||
            (member.type === "TSPropertySignature" && propertyReturnsPromise(member))
          ) {
            context.report({ node: member, messageId: "noPromiseClientSurface" });
          }
        }
      },
    };
  },
};
