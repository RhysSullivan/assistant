import { createHash } from "node:crypto";

import { ConvexHttpClient } from "convex/browser";
import { parse as parseYaml } from "yaml";

const maxBodyBytes = 256 * 1024;
const httpMethods = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const;

type HttpMethod = typeof httpMethods[number];
type OpenApiParameterLocation = "path" | "query" | "header" | "cookie";

type ExtractedTool = {
  toolId: string;
  name: string;
  description: string | null;
  method: HttpMethod;
  path: string;
  invocation: {
    method: HttpMethod;
    pathTemplate: string;
    parameters: Array<{
      name: string;
      location: OpenApiParameterLocation;
      required: boolean;
    }>;
    requestBody: {
      required: boolean;
      contentTypes: Array<string>;
    } | null;
  };
  operationHash: string;
  typing?: {
    inputSchemaJson?: string;
    outputSchemaJson?: string;
    refHintKeys?: Array<string>;
  };
};

type OpenApiManifest = {
  sourceHash: string;
  tools: Array<ExtractedTool>;
  refHintTable: Record<string, string>;
};

const parseJsonDocument = (input: string): unknown => JSON.parse(input);
const parseYamlDocument = (input: string): unknown => parseYaml(input);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

const hashUnknown = (value: unknown): string =>
  createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeToolId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "");

const escapeJsonPointer = (value: string): string =>
  value.replace(/~/g, "~0").replace(/\//g, "~1");

const unescapeJsonPointer = (value: string): string =>
  value.replace(/~1/g, "/").replace(/~0/g, "~");

const getByJsonPointer = (root: unknown, pointer: string): unknown => {
  if (!pointer.startsWith("#/")) {
    return null;
  }

  const segments = pointer
    .slice(2)
    .split("/")
    .map((segment) => unescapeJsonPointer(segment));

  let current: unknown = root;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return null;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current) || !(segment in current)) {
      return null;
    }

    current = current[segment];
  }

  return current;
};

const resolveLocalRef = (root: unknown, value: unknown, depth = 0): unknown => {
  if (depth > 8 || !isRecord(value) || typeof value.$ref !== "string") {
    return value;
  }

  const resolved = getByJsonPointer(root, value.$ref);
  if (resolved === null) {
    return value;
  }

  return resolveLocalRef(root, resolved, depth + 1);
};

const collectLocalRefKeys = (value: unknown, target: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectLocalRefKeys(entry, target);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref" && typeof entry === "string" && entry.startsWith("#/")) {
      target.add(entry);
      continue;
    }

    collectLocalRefKeys(entry, target);
  }
};

const extractParameterSchema = (
  root: unknown,
  parameter: Record<string, unknown>,
): unknown => {
  const resolved = resolveLocalRef(root, parameter);
  if (!isRecord(resolved)) {
    return {};
  }

  if (isRecord(resolved.schema)) {
    return resolved.schema;
  }

  const content = resolved.content;
  if (isRecord(content)) {
    const jsonMedia =
      (content["application/json"] as Record<string, unknown> | undefined)
      ?? (content["application/*+json"] as Record<string, unknown> | undefined);

    if (jsonMedia && isRecord(jsonMedia.schema)) {
      return jsonMedia.schema;
    }

    for (const mediaType of Object.values(content)) {
      if (isRecord(mediaType) && isRecord(mediaType.schema)) {
        return mediaType.schema;
      }
    }
  }

  return {};
};

const extractRequestBody = (
  root: unknown,
  operation: Record<string, unknown>,
): {
  required: boolean;
  contentTypes: Array<string>;
  schema: unknown;
} | null => {
  const requestBodyValue = resolveLocalRef(root, operation.requestBody);
  if (!isRecord(requestBodyValue)) {
    return null;
  }

  const content = requestBodyValue.content;
  if (!isRecord(content)) {
    return {
      required: requestBodyValue.required === true,
      contentTypes: [],
      schema: {},
    };
  }

  const contentTypes = Object.keys(content).filter((entry) => entry.trim().length > 0);
  const jsonMedia =
    (content["application/json"] as Record<string, unknown> | undefined)
    ?? (content["application/*+json"] as Record<string, unknown> | undefined);
  let schema: unknown = {};

  if (jsonMedia && isRecord(jsonMedia.schema)) {
    schema = jsonMedia.schema;
  } else {
    for (const mediaType of Object.values(content)) {
      if (isRecord(mediaType) && isRecord(mediaType.schema)) {
        schema = mediaType.schema;
        break;
      }
    }
  }

  return {
    required: requestBodyValue.required === true,
    contentTypes,
    schema,
  };
};

const extractResponseSchema = (
  root: unknown,
  operation: Record<string, unknown>,
): unknown | null => {
  const responsesValue = resolveLocalRef(root, operation.responses);
  if (!isRecord(responsesValue)) {
    return null;
  }

  const preferredKeys = Object.keys(responsesValue)
    .filter((key) => /^2\d\d$/.test(key))
    .sort();
  if ("default" in responsesValue) {
    preferredKeys.push("default");
  }

  for (const key of preferredKeys) {
    const candidate = resolveLocalRef(root, responsesValue[key]);
    if (!isRecord(candidate) || !isRecord(candidate.content)) {
      continue;
    }

    const content = candidate.content;
    const jsonMedia =
      (content["application/json"] as Record<string, unknown> | undefined)
      ?? (content["application/*+json"] as Record<string, unknown> | undefined);

    if (jsonMedia && isRecord(jsonMedia.schema)) {
      return jsonMedia.schema;
    }

    for (const mediaType of Object.values(content)) {
      if (isRecord(mediaType) && isRecord(mediaType.schema)) {
        return mediaType.schema;
      }
    }
  }

  return null;
};

const buildInputSchema = (
  root: unknown,
  parameters: Array<Record<string, unknown>>,
  requestBody: {
    required: boolean;
    schema: unknown;
  } | null,
): { schemaJson: string; refHintKeys: Array<string> } | null => {
  const properties: Record<string, unknown> = {};
  const required = new Set<string>();
  const refKeys = new Set<string>();

  for (const parameter of parameters) {
    const resolved = resolveLocalRef(root, parameter);
    if (!isRecord(resolved)) {
      continue;
    }

    const location = normalizeText(resolved.in)?.toLowerCase();
    if (
      location !== "path"
      && location !== "query"
      && location !== "header"
      && location !== "cookie"
    ) {
      continue;
    }

    const name = normalizeText(resolved.name);
    if (!name) {
      continue;
    }

    const schema = extractParameterSchema(root, resolved);
    properties[name] = schema;
    collectLocalRefKeys(schema, refKeys);

    const isRequired = resolved.required === true || location === "path";
    if (isRequired) {
      required.add(name);
    }
  }

  if (requestBody) {
    properties.body = requestBody.schema;
    collectLocalRefKeys(requestBody.schema, refKeys);
    if (requestBody.required) {
      required.add("body");
    }
  }

  if (Object.keys(properties).length === 0) {
    return null;
  }

  return {
    schemaJson: JSON.stringify({
      type: "object",
      properties,
      ...(required.size > 0 ? { required: Array.from(required).sort() } : {}),
    }),
    refHintKeys: Array.from(refKeys).sort(),
  };
};

const buildToolId = (
  method: HttpMethod,
  path: string,
  operation: Record<string, unknown>,
): string => {
  const operationId = normalizeText(operation.operationId);
  if (operationId) {
    const normalized = normalizeToolId(operationId);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const rawSegments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment.startsWith("{") && segment.endsWith("}")) {
        return segment.slice(1, -1);
      }
      return segment;
    })
    .map((segment) => normalizeSegment(segment))
    .filter((segment) => segment.length > 0);

  const segments = rawSegments.length > 0 ? rawSegments.slice(0, 6) : ["operation"];
  return normalizeToolId(`${segments.join(".")}.${method}`);
};

const dedupeToolIds = (tools: Array<ExtractedTool>): Array<ExtractedTool> => {
  const counts = new Map<string, number>();

  return tools.map((tool) => {
    const count = (counts.get(tool.toolId) ?? 0) + 1;
    counts.set(tool.toolId, count);

    if (count === 1) {
      return tool;
    }

    return {
      ...tool,
      toolId: `${tool.toolId}_${count}`,
    };
  });
};

const buildRefHintTable = (
  root: unknown,
  initialRefs: ReadonlyArray<string>,
): Record<string, string> => {
  const table: Record<string, string> = {};
  const queue = [...initialRefs];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref || visited.has(ref)) {
      continue;
    }
    visited.add(ref);

    const resolved = getByJsonPointer(root, ref);
    if (resolved === null) {
      continue;
    }

    table[ref] = JSON.stringify(resolved);

    const nestedRefs = new Set<string>();
    collectLocalRefKeys(resolved, nestedRefs);
    for (const nestedRef of nestedRefs) {
      if (!visited.has(nestedRef)) {
        queue.push(nestedRef);
      }
    }
  }

  return table;
};

const extractOpenApiManifest = (
  _sourceName: string,
  openApiSpec: unknown,
): OpenApiManifest => {
  if (!isRecord(openApiSpec)) {
    throw new Error("OpenAPI document must be an object");
  }

  const paths = openApiSpec.paths;
  if (!isRecord(paths)) {
    throw new Error("OpenAPI document is missing paths");
  }

  const tools: Array<ExtractedTool> = [];
  const globalRefKeys = new Set<string>();

  for (const [path, pathItemValue] of Object.entries(paths)) {
    if (!isRecord(pathItemValue)) {
      continue;
    }

    const sharedParameters = Array.isArray(pathItemValue.parameters)
      ? pathItemValue.parameters.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [];

    for (const method of httpMethods) {
      const operationValue = pathItemValue[method];
      if (!isRecord(operationValue)) {
        continue;
      }

      const operationParameters = Array.isArray(operationValue.parameters)
        ? operationValue.parameters.filter((entry): entry is Record<string, unknown> => isRecord(entry))
        : [];
      const parameters = [...sharedParameters, ...operationParameters];
      const requestBody = extractRequestBody(openApiSpec, operationValue);

      const invocation = {
        method,
        pathTemplate: path,
        parameters: parameters
          .map((parameter) => resolveLocalRef(openApiSpec, parameter))
          .filter((parameter): parameter is Record<string, unknown> => isRecord(parameter))
          .map((parameter) => ({
            name: normalizeText(parameter.name) ?? "",
            location:
              (normalizeText(parameter.in)?.toLowerCase() as OpenApiParameterLocation | undefined)
              ?? "query",
            required:
              parameter.required === true
              || normalizeText(parameter.in)?.toLowerCase() === "path",
          }))
          .filter((parameter) =>
            parameter.name.length > 0
            && (
              parameter.location === "path"
              || parameter.location === "query"
              || parameter.location === "header"
              || parameter.location === "cookie"
            ))
          .sort((left, right) =>
            left.location === right.location
              ? left.name.localeCompare(right.name)
              : left.location.localeCompare(right.location)),
        requestBody: requestBody
          ? {
              required: requestBody.required,
              contentTypes: requestBody.contentTypes,
            }
          : null,
      };

      const inputTyping = buildInputSchema(openApiSpec, parameters, requestBody);
      const outputSchema = extractResponseSchema(openApiSpec, operationValue);
      const outputSchemaJson = outputSchema === null ? null : JSON.stringify(outputSchema);
      if (outputSchema !== null) {
        collectLocalRefKeys(outputSchema, globalRefKeys);
      }

      if (inputTyping) {
        for (const refKey of inputTyping.refHintKeys) {
          globalRefKeys.add(refKey);
        }
      }

      const name =
        normalizeText(operationValue.summary)
        ?? normalizeText(operationValue.operationId)
        ?? `${method.toUpperCase()} ${path}`;
      const description =
        normalizeText(operationValue.description)
        ?? normalizeText(operationValue.summary)
        ?? null;
      const toolId = buildToolId(method, path, operationValue);

      tools.push({
        toolId,
        name,
        description,
        method,
        path,
        invocation,
        operationHash: hashUnknown({
          method,
          path,
          invocation,
          inputSchemaJson: inputTyping?.schemaJson ?? null,
          outputSchemaJson,
        }),
        typing: {
          ...(inputTyping ? { inputSchemaJson: inputTyping.schemaJson } : {}),
          ...(outputSchemaJson ? { outputSchemaJson } : {}),
          ...(inputTyping && inputTyping.refHintKeys.length > 0
            ? { refHintKeys: inputTyping.refHintKeys }
            : {}),
        },
      });
    }
  }

  const deduped = dedupeToolIds(tools);
  const refHintTable = buildRefHintTable(openApiSpec, Array.from(globalRefKeys));

  return {
    sourceHash: hashUnknown({
      tools: deduped.map((tool) => ({
        toolId: tool.toolId,
        operationHash: tool.operationHash,
      })),
      refKeys: Object.keys(refHintTable).sort(),
    }),
    tools: deduped,
    refHintTable,
  };
};

const parseOpenApiDocument = (input: string): unknown => {
  const text = input.trim();
  if (text.length === 0) {
    throw new Error("OpenAPI document is empty");
  }

  try {
    return parseJsonDocument(text);
  } catch {
    try {
      return parseYamlDocument(text);
    } catch (cause) {
      throw new Error(
        `Unable to parse OpenAPI document as JSON or YAML: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }
  }
};

const readRawBody = async (request: AsyncIterable<unknown>): Promise<string> => {
  const chunks: Array<Buffer> = [];
  let bytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : typeof chunk === "string"
        ? Buffer.from(chunk)
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk));
    bytes += buffer.length;
    if (bytes > maxBodyBytes) {
      throw new Error("Request body too large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
};

const json = (
  response: any,
  status: number,
  payload: Record<string, unknown>,
): void => {
  response.status(status).setHeader("content-type", "application/json; charset=utf-8");
  response.send(JSON.stringify(payload));
};

const normalizeNamespacePart = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : "source";
};

const sourceNamespace = (sourceName: string, sourceId: string): string => {
  const sourceIdSuffix = sourceId.slice(-6).toLowerCase();
  return `${normalizeNamespacePart(sourceName)}_${sourceIdSuffix}`;
};

const parseSourceEnabled = (value: unknown): boolean =>
  typeof value === "boolean" ? value : true;

const toIngestPayload = async (
  openApiSpec: unknown,
  input: {
    convexUrl: string;
    ingestToken: string;
    workspaceId: string;
    sourceId: string;
    sourceName: string;
    sourceEndpoint: string;
    sourceEnabled: boolean;
  },
): Promise<{
  artifactId: string;
  sourceHash: string;
  toolCount: number;
  namespace: string;
}> => {
  const manifest = extractOpenApiManifest(input.sourceName, openApiSpec);

  const refs = Object.entries(manifest.refHintTable ?? {}).map(([refKey, schemaJson]) => ({
    refKey,
    schemaJson,
  }));

  const tools = manifest.tools.map((tool) => ({
    toolId: tool.toolId,
    name: tool.name,
    description: tool.description,
    method: tool.method,
    path: tool.path,
    operationHash: tool.operationHash,
    invocationJson: JSON.stringify(tool.invocation),
    inputSchemaJson: tool.typing?.inputSchemaJson ?? null,
    outputSchemaJson: tool.typing?.outputSchemaJson ?? null,
  }));

  const convex = new ConvexHttpClient(input.convexUrl);
  const result = await (convex as any).action("control_plane/tool_registry:ingestOpenApiManifest", {
    token: input.ingestToken,
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    sourceName: input.sourceName,
    sourceEndpoint: input.sourceEndpoint,
    sourceEnabled: input.sourceEnabled,
    sourceHash: manifest.sourceHash,
    toolCount: manifest.tools.length,
    refs,
    tools,
  }) as {
    artifactId: string;
  };

  return {
    artifactId: result.artifactId,
    sourceHash: manifest.sourceHash,
    toolCount: manifest.tools.length,
    namespace: sourceNamespace(input.sourceName, input.sourceId),
  };
};

const parseEndpoint = async (request: any, response: any) => {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const expectedToken = process.env.OPENAPI_PARSE_API_TOKEN?.trim();
    const provided =
      typeof request.headers["x-openapi-parse-token"] === "string"
        ? request.headers["x-openapi-parse-token"].trim()
        : "";
    if (expectedToken && expectedToken.length > 0 && provided !== expectedToken) {
      json(response, 401, { error: "Unauthorized" });
      return;
    }

    const rawBody = await readRawBody(request);
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const specUrl = typeof payload.specUrl === "string" ? payload.specUrl.trim() : "";

    if (specUrl.length === 0) {
      json(response, 400, { error: "specUrl is required" });
      return;
    }

    const parsedUrl = new URL(specUrl);
    const protocol = parsedUrl.protocol.toLowerCase();
    if (protocol !== "https:" && protocol !== "http:") {
      json(response, 400, { error: "specUrl must use http:// or https://" });
      return;
    }

    const upstream = await fetch(specUrl);
    if (!upstream.ok) {
      json(response, 502, {
        error: "Failed fetching OpenAPI document",
        status: upstream.status,
        statusText: upstream.statusText,
      });
      return;
    }

    const bodyText = await upstream.text();
    const openApiSpec = parseOpenApiDocument(bodyText);

    const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId.trim() : "";
    const sourceId = typeof payload.sourceId === "string" ? payload.sourceId.trim() : "";
    const sourceName = typeof payload.sourceName === "string" ? payload.sourceName.trim() : "";

    const convexUrl =
      process.env.CONVEX_URL?.trim()
      || process.env.NEXT_PUBLIC_CONVEX_URL?.trim()
      || "";
    const ingestToken =
      process.env.OPENAPI_INGEST_SERVICE_TOKEN?.trim()
      || process.env.OPENAPI_PARSE_API_TOKEN?.trim()
      || "";

    const shouldIngest =
      workspaceId.length > 0
      && sourceId.length > 0
      && sourceName.length > 0
      && convexUrl.length > 0;

    if (shouldIngest) {
      const ingested = await toIngestPayload(openApiSpec, {
        convexUrl,
        ingestToken,
        workspaceId,
        sourceId,
        sourceName,
        sourceEndpoint: specUrl,
        sourceEnabled: parseSourceEnabled(payload.sourceEnabled),
      });

      json(response, 200, {
        ok: true,
        mode: "ingested",
        specUrl,
        artifactId: ingested.artifactId,
        sourceHash: ingested.sourceHash,
        toolCount: ingested.toolCount,
        namespace: ingested.namespace,
        artifactBatchCount: 0,
      });
      return;
    }

    json(response, 200, {
      ok: true,
      mode: "parsed",
      specUrl,
      openApiSpec,
    });
  } catch (cause) {
    json(response, 500, {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

export const config = {
  api: {
    bodyParser: false,
  },
};

export default parseEndpoint;
