import { sanitizeSegment, sanitizeSnakeSegment } from "../tool/path-utils";

function normalizeOpenApiTag(tagRaw: string): string {
  let tag = sanitizeSnakeSegment(tagRaw);
  tag = tag
    .replace(/^api_?\d{8}_?/, "")
    .replace(/^v\d+_?/, "");
  return tag || "default";
}

export function buildOpenApiToolPath(
  sourceName: string,
  tagRaw: string,
  operationIdRaw: string,
  usedPaths: Set<string>,
): string {
  const source = sanitizeSegment(sourceName);
  const tag = normalizeOpenApiTag(tagRaw);
  const operation = sanitizeSnakeSegment(operationIdRaw);
  let operationName = operation;

  if (tag !== "default" && operation.startsWith(`${tag}_`)) {
    operationName = operation.slice(tag.length + 1) || operation;
  }

  const withTag = tag === "default"
    ? `${source}.${operationName}`
    : `${source}.${tag}.${operationName}`;

  const basePath = withTag;

  let path = basePath;
  let suffix = 2;
  while (usedPaths.has(path)) {
    path = `${basePath}_${suffix}`;
    suffix += 1;
  }
  usedPaths.add(path);

  return path;
}
