import SwaggerParser from "@apidevtools/swagger-parser";
import openapiTS, { astToString } from "openapi-typescript";
import { inferOpenApiAuth } from "./openapi-auth";
import { compactOpenApiPaths } from "./openapi-compaction";
import { extractOperationIdsFromDts } from "./openapi-schema-hints";
import type { PreparedOpenApiSpec } from "./tool-source-types";
import { asRecord } from "./utils";

interface SwaggerParserAdapter {
  bundle(spec: unknown): Promise<unknown>;
  parse(spec: unknown): Promise<unknown>;
}

function createSwaggerParserAdapter(parserModule: unknown): SwaggerParserAdapter {
  const parser = parserModule as Partial<SwaggerParserAdapter>;
  if (typeof parser.parse !== "function" || typeof parser.bundle !== "function") {
    throw new Error("SwaggerParser module is missing parse/bundle methods");
  }
  const parse = parser.parse!;
  const bundle = parser.bundle!;
  return {
    parse: (spec) => parse(spec),
    bundle: (spec) => bundle(spec),
  };
}

function stripBrokenDiscriminators(spec: Record<string, unknown>): Record<string, unknown> | null {
  let strippedCount = 0;

  function refExists(ref: string): boolean {
    if (!ref.startsWith("#/")) return true;
    const segments = ref.slice(2).split("/");
    let target: unknown = spec;
    for (const segment of segments) {
      if (target && typeof target === "object") {
        target = (target as Record<string, unknown>)[segment];
      } else {
        return false;
      }
    }
    return target !== undefined;
  }

  function hasBrokenDiscriminators(obj: unknown): boolean {
    if (Array.isArray(obj)) return obj.some(hasBrokenDiscriminators);
    if (obj && typeof obj === "object") {
      const record = obj as Record<string, unknown>;
      if (record.discriminator && typeof record.discriminator === "object") {
        const disc = record.discriminator as Record<string, unknown>;
        if (disc.mapping && typeof disc.mapping === "object") {
          const mapping = disc.mapping as Record<string, string>;
          if (Object.values(mapping).some((ref) => typeof ref === "string" && !refExists(ref))) {
            return true;
          }
        }
      }
      return Object.values(record).some(hasBrokenDiscriminators);
    }
    return false;
  }

  if (!hasBrokenDiscriminators(spec)) return null;

  function walk(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(walk);
    if (obj && typeof obj === "object") {
      const record = obj as Record<string, unknown>;
      const clone: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (key === "discriminator" && typeof value === "object" && value !== null) {
          const disc = value as Record<string, unknown>;
          if (disc.mapping && typeof disc.mapping === "object") {
            const mapping = disc.mapping as Record<string, string>;
            const hasBroken = Object.values(mapping).some(
              (ref) => typeof ref === "string" && !refExists(ref),
            );
            if (hasBroken) {
              strippedCount++;
              continue;
            }
          }
        }
        clone[key] = walk(value);
      }
      return clone;
    }
    return obj;
  }

  const result = walk(spec) as Record<string, unknown>;
  console.warn(`[executor] stripped ${strippedCount} broken discriminator(s) from OpenAPI spec`);
  return result;
}

async function generateOpenApiDts(spec: Record<string, unknown>): Promise<string | null> {
  try {
    const ast = await openapiTS(spec as never, { silent: true });
    return astToString(ast);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const patched = stripBrokenDiscriminators(spec);
    if (patched) {
      console.warn(`[executor] openapi-typescript failed, retrying with patched spec: ${msg}`);
      try {
        const ast = await openapiTS(patched as never, { silent: true });
        return astToString(ast);
      } catch (retryError) {
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
        console.warn(`[executor] openapi-typescript retry also failed: ${retryMsg}`);
        return null;
      }
    }
    console.warn(`[executor] openapi-typescript failed, using fallback types: ${msg}`);
    return null;
  }
}

export async function prepareOpenApiSpec(
  spec: string | Record<string, unknown>,
  sourceName = "openapi",
): Promise<PreparedOpenApiSpec> {
  const parser = createSwaggerParserAdapter(SwaggerParser);

  const warnings: string[] = [];

  let parsed: Record<string, unknown>;
  if (typeof spec === "string") {
    try {
      parsed = (await parser.parse(spec)) as Record<string, unknown>;
    } catch (parseError) {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Failed to fetch/parse OpenAPI source '${sourceName}': ${msg}`);
    }
  } else {
    parsed = spec;
  }

  let bundled: Record<string, unknown>;
  const dtsPromise = generateOpenApiDts(parsed);
  try {
    bundled = (await parser.bundle(parsed)) as Record<string, unknown>;
  } catch (bundleError) {
    const bundleMessage = bundleError instanceof Error ? bundleError.message : String(bundleError);
    warnings.push(`OpenAPI bundle failed for '${sourceName}', using parse-only mode: ${bundleMessage}`);
    bundled = parsed;
  }
  const dts = await dtsPromise;

  const operationTypeIds = dts ? extractOperationIdsFromDts(dts) : new Set<string>();
  const servers = Array.isArray(bundled.servers) ? (bundled.servers as Array<{ url?: unknown }>) : [];
  const inferredAuth = inferOpenApiAuth(bundled);

  return {
    servers: servers
      .map((server) => (typeof server.url === "string" ? server.url : ""))
      .filter((url) => url.length > 0),
    paths: compactOpenApiPaths(
      bundled.paths,
      operationTypeIds,
      asRecord(asRecord(bundled.components).parameters),
      asRecord(asRecord(bundled.components).schemas),
      asRecord(asRecord(bundled.components).responses),
      asRecord(asRecord(bundled.components).requestBodies),
    ),
    dts: dts ?? undefined,
    ...(inferredAuth ? { inferredAuth } : {}),
    warnings,
  };
}
