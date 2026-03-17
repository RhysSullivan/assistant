import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { ToolDefinition, ToolInput } from "@executor/codemode-core";

import { extractOpenApiManifest } from "./extraction";
import { createOpenApiToolsFromManifest } from "./tools";
import type { OpenApiJsonObject } from "./types";

const VERCEL_OPENAPI_SPEC_URL = "https://openapi.vercel.sh/";

const fetchVercelOpenApiSpec = Effect.tryPromise({
  try: async () => {
    const response = await fetch(VERCEL_OPENAPI_SPEC_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch Vercel OpenAPI spec: HTTP ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<unknown>;
  },
  catch: (cause) =>
    cause instanceof Error ? cause : new Error(String(cause)),
});

type ParsedInputSchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: Array<string>;
};

const parseInputSchema = (inputSchema: unknown): ParsedInputSchema | null =>
  inputSchema ? (inputSchema as ParsedInputSchema) : null;

const resolveToolDefinition = (value: ToolInput): ToolDefinition =>
  "tool" in value ? value : { tool: value };

const expectedTools = [
  {
    toolId: "createAuthToken",
    method: "post",
    path: "/v3/user/tokens",
    tags: ["authentication"],
    requiredInputs: ["body"],
    expectedPath: "source.vercel.authentication.createAuthToken",
  },
  {
    toolId: "getProjectMembers",
    method: "get",
    path: "/v1/projects/{idOrName}/members",
    tags: ["projectMembers"],
    requiredInputs: ["idOrName"],
    expectedPath: "source.vercel.projectMembers.getProjectMembers",
  },
  {
    toolId: "addProjectDomain",
    method: "post",
    path: "/v10/projects/{idOrName}/domains",
    tags: ["projects"],
    requiredInputs: ["body", "idOrName"],
    expectedPath: "source.vercel.projects.addProjectDomain",
  },
  {
    toolId: "getDeploymentEvents",
    method: "get",
    path: "/v3/deployments/{idOrUrl}/events",
    tags: ["deployments"],
    requiredInputs: ["idOrUrl"],
    expectedPath: "source.vercel.deployments.getDeploymentEvents",
  },
  {
    toolId: "create-event",
    method: "post",
    path: "/v1/installations/{integrationConfigurationId}/events",
    tags: ["marketplace"],
    requiredInputs: ["body", "integrationConfigurationId"],
    expectedPath: "source.vercel.marketplace.createEvent",
  },
] as const;

describe("openapi-extraction real specs", () => {
  it.effect("extracts and derives tool paths from Vercel's live OpenAPI spec", () =>
    Effect.gen(function* () {
      const spec = (yield* fetchVercelOpenApiSpec) as OpenApiJsonObject;
      const manifest = yield* extractOpenApiManifest("vercel", spec);

      expect(manifest.version).toBe(2);
      expect(manifest.tools.length).toBeGreaterThan(250);

      const selectedTools = expectedTools.map((expectedTool) => {
        const tool = manifest.tools.find((candidate) => candidate.toolId === expectedTool.toolId);

        expect(tool).toBeDefined();
        expect(tool?.method).toBe(expectedTool.method);
        expect(tool?.path).toBe(expectedTool.path);
        expect(tool?.tags).toEqual(expectedTool.tags);

        return tool!;
      });

      const tools = createOpenApiToolsFromManifest({
        manifest: {
          ...manifest,
          tools: selectedTools,
        },
        baseUrl: "https://api.vercel.com",
        namespace: "source.vercel",
      });

      expect(Object.keys(tools).sort()).toEqual(
        expectedTools.map((tool) => tool.expectedPath).sort(),
      );

      for (const expectedTool of expectedTools) {
        const resolved = resolveToolDefinition(tools[expectedTool.expectedPath]!);
        const inputSchema = parseInputSchema(resolved.metadata?.inputSchema);

        expect(inputSchema?.type).toBe("object");
        expect(Object.keys(inputSchema?.properties ?? {})).toEqual(
          expect.arrayContaining([...expectedTool.requiredInputs]),
        );
        expect(inputSchema?.required ?? []).toEqual(
          expect.arrayContaining([...expectedTool.requiredInputs]),
        );
      }
    }),
  120_000);
});
