import { sanitizeSegment, sanitizeSnakeSegment } from "../tool/path-utils";
import { stringifyTemplateValue } from "../postman-utils";
import { z } from "zod";

export type PostmanRequestBody =
  | { kind: "urlencoded"; entries: Array<{ key: string; value: string }> }
  | { kind: "raw"; text: string };

const postmanKeyValueEntrySchema = z.object({
  key: z.coerce.string(),
  value: z.unknown().optional(),
  disabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

const postmanBodySchema = z.object({
  mode: z.string().optional(),
  urlencoded: z.array(postmanKeyValueEntrySchema).optional(),
  raw: z.string().optional(),
  dataMode: z.string().optional(),
  data: z.array(postmanKeyValueEntrySchema).optional(),
  rawModeData: z.string().optional(),
});

function parseKeyValueEntries(value: unknown): Array<z.infer<typeof postmanKeyValueEntrySchema>> {
  const parsed = z.array(postmanKeyValueEntrySchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function isDisabled(entry: z.infer<typeof postmanKeyValueEntrySchema>): boolean {
  return entry.disabled === true || entry.enabled === false;
}

function toNormalizedEntry(
  entry: z.infer<typeof postmanKeyValueEntrySchema>,
): { key: string; value: string } | null {
  const key = entry.key.trim();
  if (!key || isDisabled(entry)) {
    return null;
  }

  return {
    key,
    value: stringifyTemplateValue(entry.value),
  };
}

export function buildPostmanToolPath(
  sourceName: string,
  requestName: string,
  folderPath: string[],
  usedPaths: Set<string>,
): string {
  const source = sanitizeSegment(sourceName);
  const segments = [
    source,
    ...folderPath.map((segment) => sanitizeSegment(segment)).filter((segment) => segment.length > 0),
    sanitizeSnakeSegment(requestName),
  ];
  const basePath = segments.join(".");

  let path = basePath;
  let suffix = 2;
  while (usedPaths.has(path)) {
    path = `${basePath}_${suffix}`;
    suffix += 1;
  }
  usedPaths.add(path);
  return path;
}

export function resolvePostmanFolderPath(
  folderId: string | undefined,
  folderById: Map<string, { name: string; parentId?: string }>,
): string[] {
  const path: string[] = [];
  let cursor = folderId;
  let safety = 0;
  while (cursor && safety < 100) {
    safety += 1;
    const folder = folderById.get(cursor);
    if (!folder) break;
    path.unshift(folder.name);
    cursor = folder.parentId;
  }
  return path;
}

export function extractPostmanVariableMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of parseKeyValueEntries(value)) {
    const normalized = toNormalizedEntry(entry);
    if (!normalized) continue;
    result[normalized.key] = normalized.value;
  }
  return result;
}

export function extractPostmanHeaderMap(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of parseKeyValueEntries(value)) {
    const normalized = toNormalizedEntry(entry);
    if (!normalized) continue;
    result[normalized.key] = normalized.value;
  }
  return result;
}

export function extractPostmanQueryEntries(value: unknown): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  for (const entry of parseKeyValueEntries(value)) {
    const normalized = toNormalizedEntry(entry);
    if (!normalized) continue;
    entries.push(normalized);
  }
  return entries;
}

export function extractPostmanBody(value: unknown): PostmanRequestBody | undefined {
  const parsedBody = postmanBodySchema.safeParse(value);
  if (!parsedBody.success) return undefined;

  const body = parsedBody.data;
  const mode = (body.mode ?? body.dataMode ?? "").trim().toLowerCase();

  if (mode === "urlencoded") {
    const rawEntries = body.urlencoded ?? body.data ?? [];
    const entries = rawEntries
      .map((entry) => toNormalizedEntry(entry))
      .filter((entry): entry is { key: string; value: string } => Boolean(entry));
    return entries.length > 0 ? { kind: "urlencoded", entries } : undefined;
  }

  if (mode === "raw") {
    const rawText = body.raw ?? body.rawModeData ?? "";
    if (rawText.trim().length > 0) {
      return { kind: "raw", text: rawText };
    }
  }

  if ((body.rawModeData ?? "").trim().length > 0) {
    return { kind: "raw", text: body.rawModeData ?? "" };
  }

  if ((body.raw ?? "").trim().length > 0) {
    return { kind: "raw", text: body.raw ?? "" };
  }

  return undefined;
}
