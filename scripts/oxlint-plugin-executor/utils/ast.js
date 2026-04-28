export const isIdentifier = (node, name) =>
  node?.type === "Identifier" && (name === undefined || node.name === name);

export const isStringLiteral = (node) =>
  node?.type === "Literal" && typeof node.value === "string";

export const typeName = (node) => {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "TSQualifiedName") {
    const left = typeName(node.left);
    const right = typeName(node.right);
    return left && right ? `${left}.${right}` : undefined;
  }
  return undefined;
};

export const typeReferenceName = (node) =>
  node?.type === "TSTypeReference" ? typeName(node.typeName) : undefined;

export const isPromiseType = (node) => typeReferenceName(node) === "Promise";

export const containsPromiseType = (node) => {
  if (!node || typeof node !== "object") return false;
  if (isPromiseType(node)) return true;

  switch (node.type) {
    case "TSTypeAnnotation":
      return containsPromiseType(node.typeAnnotation);
    case "TSFunctionType":
      return containsPromiseType(node.returnType);
    case "TSParenthesizedType":
      return containsPromiseType(node.typeAnnotation);
    case "TSUnionType":
    case "TSIntersectionType":
      return (node.types ?? []).some(containsPromiseType);
    case "TSConditionalType":
      return containsPromiseType(node.trueType) || containsPromiseType(node.falseType);
    default:
      return false;
  }
};

export const nodeName = (node) => {
  if (isIdentifier(node)) return node.name;
  if (node?.type === "PrivateIdentifier") return node.name;
  if (isStringLiteral(node)) return node.value;
  return undefined;
};
