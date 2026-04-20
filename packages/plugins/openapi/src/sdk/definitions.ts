/**
 * Derives structured `group.leaf` tool paths from extracted OpenAPI operations.
 *
 * Ported from the v3 executor's `definitions.ts`. Turns flat operation IDs like
 * `zones_listZones` into nested paths like `zones.listZones` that the tree UI
 * can render with proper nesting.
 *
 * ## Schema selection for LLM tool definitions
 *
 * Tool callers (LLMs) take a single input schema and a single output schema
 * per tool. OpenAPI operations can declare many responses per status code
 * — `200`, `201`, `default`, per-error schemas — plus request bodies with
 * their own rules about which fields are server-managed vs. client-settable.
 *
 * We resolve that down to a single pair here:
 *   - Input schema: `operation.inputSchema` — already filtered for
 *     `readOnly: true` fields in `extract.ts`, so the LLM won't try to
 *     set server-managed fields like `id` or `created_at` on POSTs.
 *   - Output schema: `operation.outputSchema` — already filtered for
 *     `writeOnly: true` fields in `extract.ts`, so the LLM doesn't expect
 *     `password`-class fields to be present on GETs. The chosen schema
 *     comes from the first 2xx response that has a body, with `default`
 *     as a final fallback (see `pickPreferredOutputSchema` in extract.ts).
 *
 * Callers that need the full response map (201 vs 200 shape differences,
 * documented response headers, error-envelope schemas) should read
 * `operation.responses` directly instead of going through tool definitions.
 */

import type { ExtractedOperation } from "./types";

// ---------------------------------------------------------------------------
// Word / case utilities
// ---------------------------------------------------------------------------

const splitWords = (value: string): string[] =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);

const normalizeWord = (value: string): string => value.toLowerCase();

const toCamelCase = (value: string): string => {
  const words = splitWords(value).map(normalizeWord);
  if (words.length === 0) return "tool";
  const [first, ...rest] = words;
  return `${first}${rest.map((p) => `${p[0]?.toUpperCase() ?? ""}${p.slice(1)}`).join("")}`;
};

const toPascalCase = (value: string): string => {
  const camel = toCamelCase(value);
  return `${camel[0]?.toUpperCase() ?? ""}${camel.slice(1)}`;
};

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

const VERSION_SEGMENT_REGEX = /^v\d+(?:[._-]\d+)?$/i;
const IGNORED_PATH_SEGMENTS = new Set(["api"]);

const pathSegmentsFromTemplate = (pathTemplate: string): string[] =>
  pathTemplate
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const isPathParameterSegment = (segment: string): boolean =>
  segment.startsWith("{") && segment.endsWith("}");

const normalizeGroupSegment = (value: string | undefined): string | null => {
  const candidate = value?.trim();
  if (!candidate) return null;
  return toCamelCase(candidate);
};

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

const deriveVersionSegment = (pathTemplate: string): string | undefined =>
  pathSegmentsFromTemplate(pathTemplate)
    .map((s) => s.toLowerCase())
    .find((s) => VERSION_SEGMENT_REGEX.test(s));

const derivePathGroup = (pathTemplate: string): string => {
  for (const segment of pathSegmentsFromTemplate(pathTemplate)) {
    const lower = segment.toLowerCase();
    if (VERSION_SEGMENT_REGEX.test(lower)) continue;
    if (IGNORED_PATH_SEGMENTS.has(lower)) continue;
    if (isPathParameterSegment(segment)) continue;
    return normalizeGroupSegment(segment) ?? "root";
  }
  return "root";
};

const splitOperationIdSegments = (value: string): string[] =>
  value
    .split(/[/.]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const deriveLeafSeed = (operationId: string, group: string): string => {
  const segments = splitOperationIdSegments(operationId);
  if (segments.length > 1) {
    const [first, ...rest] = segments;
    if ((normalizeGroupSegment(first) ?? first) === group && rest.length > 0) {
      return rest.join(" ");
    }
  }
  return operationId;
};

const fallbackLeafSeed = (method: string, pathTemplate: string, group: string): string => {
  const relevantSegments = pathSegmentsFromTemplate(pathTemplate)
    .filter((s) => !VERSION_SEGMENT_REGEX.test(s.toLowerCase()))
    .filter((s) => !IGNORED_PATH_SEGMENTS.has(s.toLowerCase()))
    .filter((s) => !isPathParameterSegment(s))
    .map((s) => normalizeGroupSegment(s) ?? s)
    .filter((s) => s !== group);

  const segmentSuffix = relevantSegments.map((s) => toPascalCase(s)).join("");
  return `${method}${segmentSuffix || "Operation"}`;
};

const deriveLeaf = (
  operationId: string,
  method: string,
  pathTemplate: string,
  group: string,
): string => {
  const preferred = toCamelCase(deriveLeafSeed(operationId, group));
  if (preferred.length > 0 && preferred !== group) return preferred;
  return toCamelCase(fallbackLeafSeed(method, pathTemplate, group));
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  /** Dot-separated path like `zones.listZones` */
  readonly toolPath: string;
  /** The group segment */
  readonly group: string;
  /** The leaf segment */
  readonly leaf: string;
  /** Index into the original operations array */
  readonly operationIndex: number;
  /** The original operation */
  readonly operation: ExtractedOperation;
}

// ---------------------------------------------------------------------------
// Collision resolution
// ---------------------------------------------------------------------------

const resolveCollisions = (
  definitions: {
    toolPath: string;
    group: string;
    leaf: string;
    versionSegment: string | undefined;
    method: string;
    operationHash: string;
    operationIndex: number;
    operation: ExtractedOperation;
  }[],
): ToolDefinition[] => {
  // Mutable — we progressively refine toolPath on collision
  const staged = definitions.map((d) => ({ ...d }));

  const applyFactory = (items: typeof staged, factory: (d: (typeof staged)[number]) => string) => {
    const byPath = new Map<string, typeof staged>();
    for (const item of items) {
      const bucket = byPath.get(item.toolPath) ?? [];
      bucket.push(item);
      byPath.set(item.toolPath, bucket);
    }
    for (const bucket of byPath.values()) {
      if (bucket.length < 2) continue;
      for (const d of bucket) {
        d.toolPath = factory(d);
      }
    }
  };

  // Round 1: add version segment
  applyFactory(staged, (d) =>
    d.versionSegment ? `${d.group}.${d.versionSegment}.${d.leaf}` : d.toolPath,
  );

  // Round 2: add method suffix
  applyFactory(staged, (d) => {
    const prefix = d.versionSegment ? `${d.group}.${d.versionSegment}` : d.group;
    return `${prefix}.${d.leaf}${toPascalCase(d.method)}`;
  });

  // Round 3: add hash suffix
  applyFactory(staged, (d) => {
    const prefix = d.versionSegment ? `${d.group}.${d.versionSegment}` : d.group;
    return `${prefix}.${d.leaf}${toPascalCase(d.method)}${d.operationHash.slice(0, 8)}`;
  });

  return staged.map((d) => ({
    toolPath: d.toolPath,
    group: d.group,
    leaf: d.leaf,
    operationIndex: d.operationIndex,
    operation: d.operation,
  }));
};

// ---------------------------------------------------------------------------
// Stable hash (simple, deterministic)
// ---------------------------------------------------------------------------

const stableHash = (value: unknown): string => {
  const str = JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Compile extracted operations into tool definitions with structured
 * `group.leaf` paths suitable for tree rendering.
 */
export const compileToolDefinitions = (
  operations: readonly ExtractedOperation[],
): ToolDefinition[] => {
  const raw = operations.map((op, index) => {
    const operationId = op.operationId as string;
    const group = normalizeGroupSegment(op.tags[0]) ?? derivePathGroup(op.pathTemplate);
    const leaf = deriveLeaf(operationId, op.method, op.pathTemplate, group);
    const versionSegment = deriveVersionSegment(op.pathTemplate);
    const operationHash = stableHash({
      method: op.method,
      path: op.pathTemplate,
      operationId,
    });

    return {
      toolPath: `${group}.${leaf}`,
      group,
      leaf,
      versionSegment,
      method: op.method,
      operationHash,
      operationIndex: index,
      operation: op,
    };
  });

  return resolveCollisions(raw).sort((a, b) => a.toolPath.localeCompare(b.toolPath));
};
