/**
 * OpenAssistant Server — Elysia + Eden Treaty
 *
 * Starts the server with tool sources loaded from config.
 * The exported App type is consumed by Eden Treaty clients.
 */

import { readFileSync } from "node:fs";
import { createApp } from "./routes.js";
import { createPiAiModel } from "@openassistant/core";
import { defineTool, mergeToolTrees, type ToolTree } from "@openassistant/core/tools";
import { generateMcpTools } from "@openassistant/tool-gen/mcp";
import type { McpToolSource } from "@openassistant/tool-gen/mcp";
import { generateOpenApiTools } from "@openassistant/tool-gen/openapi";
import type { OpenApiToolSource } from "@openassistant/tool-gen/openapi";
import { z } from "zod";

// ---------------------------------------------------------------------------
// API key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Anthropic API key from (in order):
 * 1. ANTHROPIC_OAUTH_TOKEN env var
 * 2. ANTHROPIC_API_KEY env var
 * 3. Claude Code's credential store (~/.claude/.credentials.json)
 */
function getAnthropicApiKey(): string | undefined {
  if (process.env["ANTHROPIC_OAUTH_TOKEN"]) return process.env["ANTHROPIC_OAUTH_TOKEN"];
  if (process.env["ANTHROPIC_API_KEY"]) return process.env["ANTHROPIC_API_KEY"];

  try {
    const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
    const text = readFileSync(`${home}/.claude/.credentials.json`, "utf-8");
    const creds = JSON.parse(text);
    const token = (creds as Record<string, Record<string, unknown>>)?.["claudeAiOauth"]?.["accessToken"];
    if (typeof token === "string" && token.startsWith("sk-ant-")) {
      return token;
    }
  } catch {
    // No credentials file
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Tool source config
// ---------------------------------------------------------------------------

const mcpSources: McpToolSource[] = [
  {
    name: "answeroverflow",
    url: "https://www.answeroverflow.com/mcp",
    defaultApproval: "auto",
  },
];

const POSTHOG_API_KEY = process.env["POSTHOG_PERSONAL_API_KEY"];
const POSTHOG_PROJECT_ID = process.env["POSTHOG_PROJECT_ID"];
const GITHUB_TOKEN = process.env["OPENASSISTANT_GITHUB_TOKEN"];
const VERCEL_TOKEN = process.env["VERCEL_TOKEN"];

const openApiSources: OpenApiToolSource[] = [
  ...(POSTHOG_API_KEY ? [{
    name: "posthog",
    spec: "https://app.posthog.com/api/schema/?format=json",
    baseUrl: "https://app.posthog.com",
    auth: { type: "bearer" as const, token: POSTHOG_API_KEY },
    defaultReadApproval: "auto" as const,
    defaultWriteApproval: "required" as const,
  }] : []),
  ...(GITHUB_TOKEN ? [{
    name: "github",
    spec: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json",
    auth: { type: "bearer" as const, token: GITHUB_TOKEN },
    defaultReadApproval: "auto" as const,
    defaultWriteApproval: "required" as const,
  }] : []),
  ...(VERCEL_TOKEN ? [{
    name: "vercel",
    spec: "https://openapi.vercel.sh/",
    auth: { type: "bearer" as const, token: VERCEL_TOKEN },
    defaultReadApproval: "auto" as const,
    defaultWriteApproval: "required" as const,
  }] : []),
];

// ---------------------------------------------------------------------------
// Hand-written tools (approval testing)
// ---------------------------------------------------------------------------

const builtinTools: ToolTree = {
  admin: {
    /** Requires approval — lets you test the approval UI flow. */
    send_announcement: defineTool({
      description: "Send an announcement message to a channel. Requires approval because it posts publicly.",
      approval: "required",
      args: z.object({
        channel: z.string().describe("Channel name to post in"),
        message: z.string().describe("The announcement text"),
      }),
      returns: z.object({ sent: z.boolean(), channel: z.string(), message: z.string() }),
      run: async (input) => ({ sent: true, channel: input.channel, message: input.message }),
      formatApproval: (input) => ({
        title: `Post to #${input.channel}`,
        details: `Message: "${input.message}"`,
      }),
    }),

    /** Requires approval — destructive action. */
    delete_data: defineTool({
      description: "Delete stored data by key. Requires approval because it's destructive.",
      approval: "required",
      args: z.object({
        key: z.string().describe("The data key to delete"),
      }),
      returns: z.object({ deleted: z.boolean(), key: z.string() }),
      run: async (input) => ({ deleted: true, key: input.key }),
      formatApproval: (input) => ({
        title: `Delete "${input.key}"`,
        details: "This action cannot be undone.",
      }),
    }),
  },

  utils: {
    /** Auto-approved — safe read-only tool. */
    get_time: defineTool({
      description: "Get the current date and time.",
      approval: "auto",
      args: z.object({}),
      returns: z.object({ iso: z.string(), unix: z.number() }),
      run: async () => ({ iso: new Date().toISOString(), unix: Date.now() }),
    }),
  },
};

// ---------------------------------------------------------------------------
// Tool loading
// ---------------------------------------------------------------------------

async function loadTools(): Promise<ToolTree> {
  const trees: ToolTree[] = [builtinTools];

  // Load MCP tools
  for (const source of mcpSources) {
    try {
      console.log(`Loading MCP tools from ${source.name} (${source.url})...`);
      const result = await generateMcpTools(source);
      trees.push(result.tools);
      console.log(`  Loaded ${Object.keys(result.tools[source.name] ?? {}).length} tools from ${source.name}`);
    } catch (error) {
      console.error(`  Failed to load ${source.name}:`, error instanceof Error ? error.message : error);
    }
  }

  // Load OpenAPI tools
  for (const source of openApiSources) {
    try {
      console.log(`Loading OpenAPI tools from ${source.name}...`);
      const result = await generateOpenApiTools(source);
      trees.push(result.tools);
      const nsTools = result.tools[source.name];
      const count = nsTools ? Object.values(nsTools).reduce((sum, tag) => {
        return sum + (typeof tag === "object" && tag !== null ? Object.keys(tag).length : 1);
      }, 0) : 0;
      console.log(`  Loaded ~${count} tools from ${source.name}`);
    } catch (error) {
      console.error(`  Failed to load ${source.name}:`, error instanceof Error ? error.message : error);
    }
  }

  return mergeToolTrees(...trees);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = Number(process.env["PORT"] ?? 3000);

const apiKey = getAnthropicApiKey();
if (!apiKey) {
  console.error("WARNING: No Anthropic API key found. Set ANTHROPIC_API_KEY, ANTHROPIC_OAUTH_TOKEN, or have Claude Code credentials at ~/.claude/.credentials.json");
}

console.log("Loading tools...");
const tools = await loadTools();
const model = createPiAiModel({ apiKey });

const app = createApp({ tools, model });

app.listen(PORT);

console.log(`\u{1f98a} OpenAssistant server running at http://localhost:${PORT}`);

// Re-export the app type for Eden Treaty clients
export type { App } from "./routes.js";
