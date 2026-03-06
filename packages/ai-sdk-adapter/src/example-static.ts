import { tool } from "ai";
import { z } from "zod";

import { createStaticDiscoveryFromTools } from "@executor-v3/codemode-core";

import { createToolsFromAiSdkTools } from "./index";

const listIssues = tool({
  description: "List repository issues",
  inputSchema: z.object({ owner: z.string(), repo: z.string() }),
  execute: async ({ owner, repo }: { owner: string; repo: string }) => ({
    items: [`${owner}/${repo}#1`],
  }),
});

const createIssue = tool({
  description: "Create repository issue",
  inputSchema: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
  }),
  execute: async ({ owner, repo, title }: { owner: string; repo: string; title: string }) => ({
    id: "issue_123",
    owner,
    repo,
    title,
  }),
});

const wrappedTools = createToolsFromAiSdkTools({
  tools: {
    "github.issues.list": listIssues,
    "github.issues.create": createIssue,
  },
  sourceKey: "api.github",
});

export const staticDemo = createStaticDiscoveryFromTools({
  tools: wrappedTools,
  sourceKey: "api.github",
});
