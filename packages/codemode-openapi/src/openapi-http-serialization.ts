type OpenApiSerializableLocation = "path" | "query" | "header" | "cookie";

export type OpenApiSerializableContent = {
  mediaType: string;
};

export type OpenApiSerializableParameter = {
  name: string;
  location: OpenApiSerializableLocation;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  content?: ReadonlyArray<OpenApiSerializableContent>;
};

export type OpenApiSerializableRequestBody = {
  contentTypes?: ReadonlyArray<string>;
  contents?: ReadonlyArray<OpenApiSerializableContent>;
};

export type HttpBodyDecodingMode = "json" | "text" | "bytes";

export type SerializedOpenApiRequestBody = {
  contentType: string;
  body: string | Uint8Array;
};

export type SerializedOpenApiQueryEntry = {
  name: string;
  value: string;
  allowReserved?: boolean;
};

export type SerializedOpenApiParameterValue =
  | {
      kind: "path" | "header";
      value: string;
    }
  | {
      kind: "query";
      entries: ReadonlyArray<SerializedOpenApiQueryEntry>;
    }
  | {
      kind: "cookie";
      pairs: ReadonlyArray<{
        name: string;
        value: string;
      }>;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const textEncoder = new TextEncoder();

const normalizeMediaType = (value: string | undefined | null): string =>
  (value ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase()
    ?? "";

const primitiveString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "bigint"
  ) {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const isJsonMediaType = (mediaType: string | undefined | null): boolean => {
  const normalized = normalizeMediaType(mediaType);
  return normalized === "application/json"
    || normalized.endsWith("+json")
    || normalized.includes("json");
};

export const isTextMediaType = (mediaType: string | undefined | null): boolean => {
  const normalized = normalizeMediaType(mediaType);
  if (normalized.length === 0) {
    return false;
  }

  return normalized.startsWith("text/")
    || normalized === "application/xml"
    || normalized.endsWith("+xml")
    || normalized.endsWith("/xml")
    || normalized === "application/x-www-form-urlencoded"
    || normalized === "application/javascript"
    || normalized === "application/ecmascript"
    || normalized === "application/graphql"
    || normalized === "application/sql"
    || normalized === "application/x-yaml"
    || normalized === "application/yaml"
    || normalized === "application/toml"
    || normalized === "application/csv"
    || normalized === "image/svg+xml"
    || normalized.endsWith("+yaml")
    || normalized.endsWith("+toml");
};

export const httpBodyModeFromContentType = (
  mediaType: string | undefined | null,
): HttpBodyDecodingMode => {
  if (isJsonMediaType(mediaType)) {
    return "json";
  }

  if (isTextMediaType(mediaType)) {
    return "text";
  }

  const normalized = normalizeMediaType(mediaType);
  if (normalized.length === 0) {
    return "text";
  }

  return "bytes";
};

const objectEntries = (value: unknown): Array<[string, unknown]> =>
  Object.entries(isRecord(value) ? value : {})
    .sort(([left], [right]) => left.localeCompare(right));

const defaultStyle = (location: OpenApiSerializableLocation): string => {
  switch (location) {
    case "path":
    case "header":
      return "simple";
    case "cookie":
    case "query":
      return "form";
  }
};

const defaultExplode = (location: OpenApiSerializableLocation, style: string): boolean =>
  location === "query" || location === "cookie"
    ? style === "form"
    : false;

const selectedStyle = (parameter: OpenApiSerializableParameter): string =>
  parameter.style ?? defaultStyle(parameter.location);

const selectedExplode = (parameter: OpenApiSerializableParameter): boolean =>
  parameter.explode ?? defaultExplode(parameter.location, selectedStyle(parameter));

const encodePathPart = (value: unknown): string =>
  encodeURIComponent(primitiveString(value));

const encodeQueryValue = (value: string, allowReserved: boolean): string => {
  const encoded = encodeURIComponent(value);
  if (!allowReserved) {
    return encoded;
  }

  return encoded
    .replace(/%3A/gi, ":")
    .replace(/%2F/gi, "/")
    .replace(/%3F/gi, "?")
    .replace(/%23/gi, "#")
    .replace(/%5B/gi, "[")
    .replace(/%5D/gi, "]")
    .replace(/%40/gi, "@")
    .replace(/%21/gi, "!")
    .replace(/%24/gi, "$")
    .replace(/%26/gi, "&")
    .replace(/%27/gi, "'")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")")
    .replace(/%2A/gi, "*")
    .replace(/%2B/gi, "+")
    .replace(/%2C/gi, ",")
    .replace(/%3B/gi, ";")
    .replace(/%3D/gi, "=");
};

const preferredContentType = (input: {
  contents?: ReadonlyArray<OpenApiSerializableContent>;
  contentTypes?: ReadonlyArray<string>;
}): string | undefined => {
  const candidates = [
    ...(input.contents ?? []).map((content) => content.mediaType),
    ...(input.contentTypes ?? []),
  ];
  if (candidates.length === 0) {
    return undefined;
  }

  return candidates.find((mediaType) => mediaType === "application/json")
    ?? candidates.find((mediaType) => mediaType.toLowerCase().includes("+json"))
    ?? candidates.find((mediaType) => mediaType.toLowerCase().includes("json"))
    ?? candidates[0];
};

const serializeBinaryContentValue = (value: unknown): Uint8Array => {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (typeof value === "string") {
    return textEncoder.encode(value);
  }

  if (
    Array.isArray(value)
    && value.every((entry) =>
      typeof entry === "number"
      && Number.isInteger(entry)
      && entry >= 0
      && entry <= 255)
  ) {
    return Uint8Array.from(value);
  }

  throw new Error("Binary OpenAPI request bodies must be bytes, a string, or an array of byte values");
};

const serializeContentValue = (value: unknown, mediaType: string): string => {
  const normalized = mediaType.toLowerCase();
  if (
    normalized === "application/json"
    || normalized.includes("+json")
    || normalized.includes("json")
  ) {
    return JSON.stringify(value);
  }

  if (normalized === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams();
    for (const [key, entryValue] of objectEntries(value)) {
      if (Array.isArray(entryValue)) {
        for (const item of entryValue) {
          params.append(key, primitiveString(item));
        }
        continue;
      }

      params.append(key, primitiveString(entryValue));
    }
    return params.toString();
  }

  return primitiveString(value);
};

const serializeQueryParameter = (
  parameter: OpenApiSerializableParameter,
  value: unknown,
): SerializedOpenApiParameterValue => {
  const style = selectedStyle(parameter);
  const explode = selectedExplode(parameter);
  const allowReserved = parameter.allowReserved === true;
  const contentType = preferredContentType({ contents: parameter.content });

  if (contentType) {
    return {
      kind: "query",
      entries: [{
        name: parameter.name,
        value: serializeContentValue(value, contentType),
        allowReserved,
      }],
    };
  }

  if (Array.isArray(value)) {
    if (style === "spaceDelimited") {
      return {
        kind: "query",
        entries: [{
          name: parameter.name,
          value: value.map((entry) => primitiveString(entry)).join(" "),
          allowReserved,
        }],
      };
    }

    if (style === "pipeDelimited") {
      return {
        kind: "query",
        entries: [{
          name: parameter.name,
          value: value.map((entry) => primitiveString(entry)).join("|"),
          allowReserved,
        }],
      };
    }

    return {
      kind: "query",
      entries:
        explode
          ? value.map((entry) => ({
              name: parameter.name,
              value: primitiveString(entry),
              allowReserved,
            }))
          : [{
              name: parameter.name,
              value: value.map((entry) => primitiveString(entry)).join(","),
              allowReserved,
            }],
    };
  }

  if (isRecord(value)) {
    const entries = objectEntries(value);

    if (style === "deepObject") {
      return {
        kind: "query",
        entries: entries.map(([key, entryValue]) => ({
          name: `${parameter.name}[${key}]`,
          value: primitiveString(entryValue),
          allowReserved,
        })),
      };
    }

    return {
      kind: "query",
      entries:
        explode
          ? entries.map(([key, entryValue]) => ({
              name: key,
              value: primitiveString(entryValue),
              allowReserved,
            }))
          : [{
              name: parameter.name,
              value: entries.flatMap(([key, entryValue]) => [key, primitiveString(entryValue)]).join(","),
              allowReserved,
            }],
    };
  }

  return {
    kind: "query",
    entries: [{
      name: parameter.name,
      value: primitiveString(value),
      allowReserved,
    }],
  };
};

const serializeHeaderParameter = (
  parameter: OpenApiSerializableParameter,
  value: unknown,
): SerializedOpenApiParameterValue => {
  const explode = selectedExplode(parameter);
  const contentType = preferredContentType({ contents: parameter.content });
  if (contentType) {
    return {
      kind: "header",
      value: serializeContentValue(value, contentType),
    };
  }

  if (Array.isArray(value)) {
    return {
      kind: "header",
      value: value.map((entry) => primitiveString(entry)).join(","),
    };
  }

  if (isRecord(value)) {
    const entries = objectEntries(value);
    return {
      kind: "header",
      value:
        explode
          ? entries.map(([key, entryValue]) => `${key}=${primitiveString(entryValue)}`).join(",")
          : entries.flatMap(([key, entryValue]) => [key, primitiveString(entryValue)]).join(","),
    };
  }

  return {
    kind: "header",
    value: primitiveString(value),
  };
};

const serializeCookieParameter = (
  parameter: OpenApiSerializableParameter,
  value: unknown,
): SerializedOpenApiParameterValue => {
  const explode = selectedExplode(parameter);
  const contentType = preferredContentType({ contents: parameter.content });
  if (contentType) {
    return {
      kind: "cookie",
      pairs: [{
        name: parameter.name,
        value: serializeContentValue(value, contentType),
      }],
    };
  }

  if (Array.isArray(value)) {
    return {
      kind: "cookie",
      pairs:
        explode
          ? value.map((entry) => ({
              name: parameter.name,
              value: primitiveString(entry),
            }))
          : [{
              name: parameter.name,
              value: value.map((entry) => primitiveString(entry)).join(","),
            }],
    };
  }

  if (isRecord(value)) {
    const entries = objectEntries(value);
    return {
      kind: "cookie",
      pairs:
        explode
          ? entries.map(([key, entryValue]) => ({
              name: key,
              value: primitiveString(entryValue),
            }))
          : [{
              name: parameter.name,
              value: entries.flatMap(([key, entryValue]) => [key, primitiveString(entryValue)]).join(","),
            }],
    };
  }

  return {
    kind: "cookie",
    pairs: [{
      name: parameter.name,
      value: primitiveString(value),
    }],
  };
};

const serializePathParameter = (
  parameter: OpenApiSerializableParameter,
  value: unknown,
): SerializedOpenApiParameterValue => {
  const style = selectedStyle(parameter);
  const explode = selectedExplode(parameter);
  const contentType = preferredContentType({ contents: parameter.content });
  if (contentType) {
    return {
      kind: "path",
      value: encodePathPart(serializeContentValue(value, contentType)),
    };
  }

  if (Array.isArray(value)) {
    if (style === "label") {
      return {
        kind: "path",
        value: `.${value.map((entry) => encodePathPart(entry)).join(explode ? "." : ",")}`,
      };
    }

    if (style === "matrix") {
      return {
        kind: "path",
        value:
          explode
            ? value.map((entry) => `;${encodeURIComponent(parameter.name)}=${encodePathPart(entry)}`).join("")
            : `;${encodeURIComponent(parameter.name)}=${value.map((entry) => encodePathPart(entry)).join(",")}`,
      };
    }

    return {
      kind: "path",
      value: value.map((entry) => encodePathPart(entry)).join(","),
    };
  }

  if (isRecord(value)) {
    const entries = objectEntries(value);

    if (style === "label") {
      return {
        kind: "path",
        value:
          explode
            ? `.${entries.map(([key, entryValue]) => `${encodePathPart(key)}=${encodePathPart(entryValue)}`).join(".")}`
            : `.${entries.flatMap(([key, entryValue]) => [encodePathPart(key), encodePathPart(entryValue)]).join(",")}`,
      };
    }

    if (style === "matrix") {
      return {
        kind: "path",
        value:
          explode
            ? entries.map(([key, entryValue]) => `;${encodeURIComponent(key)}=${encodePathPart(entryValue)}`).join("")
            : `;${encodeURIComponent(parameter.name)}=${entries.flatMap(([key, entryValue]) => [
                encodePathPart(key),
                encodePathPart(entryValue),
              ]).join(",")}`,
      };
    }

    return {
      kind: "path",
      value:
        explode
          ? entries.map(([key, entryValue]) => `${encodePathPart(key)}=${encodePathPart(entryValue)}`).join(",")
          : entries.flatMap(([key, entryValue]) => [encodePathPart(key), encodePathPart(entryValue)]).join(","),
    };
  }

  if (style === "label") {
    return {
      kind: "path",
      value: `.${encodePathPart(value)}`,
    };
  }

  if (style === "matrix") {
    return {
      kind: "path",
      value: `;${encodeURIComponent(parameter.name)}=${encodePathPart(value)}`,
    };
  }

  return {
    kind: "path",
    value: encodePathPart(value),
  };
};

export const serializeOpenApiParameterValue = (
  parameter: OpenApiSerializableParameter,
  value: unknown,
): SerializedOpenApiParameterValue => {
  switch (parameter.location) {
    case "path":
      return serializePathParameter(parameter, value);
    case "query":
      return serializeQueryParameter(parameter, value);
    case "header":
      return serializeHeaderParameter(parameter, value);
    case "cookie":
      return serializeCookieParameter(parameter, value);
  }
};

export const withSerializedQueryEntries = (
  url: URL,
  entries: ReadonlyArray<SerializedOpenApiQueryEntry>,
): string => {
  if (entries.length === 0) {
    return url.toString();
  }

  const suffix = entries
    .map((entry) =>
      `${encodeURIComponent(entry.name)}=${encodeQueryValue(entry.value, entry.allowReserved === true)}`
    )
    .join("&");

  const urlText = url.toString();
  const [withoutHash, hashFragment] = urlText.split("#", 2);
  const separator =
    withoutHash.includes("?")
      ? (withoutHash.endsWith("?") || withoutHash.endsWith("&") ? "" : "&")
      : "?";

  return `${withoutHash}${separator}${suffix}${hashFragment ? `#${hashFragment}` : ""}`;
};

export const serializeOpenApiRequestBody = (input: {
  requestBody: OpenApiSerializableRequestBody;
  body: unknown;
}): SerializedOpenApiRequestBody => {
  const contentType = preferredContentType(input.requestBody) ?? "application/json";

  if (httpBodyModeFromContentType(contentType) === "bytes") {
    return {
      contentType,
      body: serializeBinaryContentValue(input.body),
    };
  }

  return {
    contentType,
    body: serializeContentValue(input.body, contentType),
  };
};
