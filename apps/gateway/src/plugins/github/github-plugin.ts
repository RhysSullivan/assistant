import { defineTool, type ToolTree } from "@openassistant/core";
import { Effect } from "effect";
import { GitHubClient, type GitHubIssueSummary } from "./github-client.js";
import type { GatewayPlugin } from "../plugin-system.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function createGitHubPlugin(): GatewayPlugin {
  const tools: ToolTree = {
    github: {
      issues: {
        listOlderThan: defineTool({
          kind: "read",
          approval: "auto",
          run: (input: {
            owner: string;
            repo: string;
            olderThanDays: number;
            limit?: number;
          }) =>
            Effect.gen(function* () {
              const github = yield* GitHubClient;
              const cutoff = Date.now() - Math.max(input.olderThanDays, 0) * DAY_MS;
              const limit = Math.max(1, Math.min(input.limit ?? 200, 500));
              const all: Array<GitHubIssueSummary> = [];
              let page = 1;

              while (all.length < limit) {
                const issues = yield* github.use((client) =>
                  client.listOpenIssues({
                    owner: input.owner,
                    repo: input.repo,
                    page,
                    perPage: 100,
                  }),
                );
                if (issues.length === 0) {
                  break;
                }

                const matching = issues.filter((issue) => new Date(issue.createdAt).getTime() < cutoff);
                all.push(...matching);

                if (issues.length < 100) {
                  break;
                }
                page += 1;
              }

              return all.slice(0, limit);
            }).pipe(Effect.provide(GitHubClient.Default)),
          previewInput: (input) =>
            `${input.owner}/${input.repo} older-than=${input.olderThanDays}d`,
        }),
        close: defineTool({
          kind: "write",
          approval: "required",
          run: (input: {
            owner: string;
            repo: string;
            issueNumber: number;
            issueTitle?: string;
            issueUrl?: string;
            reason?: "completed" | "not_planned" | "reopened";
          }) =>
            Effect.gen(function* () {
              const github = yield* GitHubClient;
              return yield* github.use((client) =>
                client.closeIssue({
                  owner: input.owner,
                  repo: input.repo,
                  issueNumber: input.issueNumber,
                  ...(input.reason ? { reason: input.reason } : {}),
                }),
              );
            }).pipe(Effect.provide(GitHubClient.Default)),
          previewInput: (input) =>
            `${input.owner}/${input.repo}#${input.issueNumber}${input.issueTitle ? ` "${input.issueTitle}"` : ""}`,
        }),
      },
    },
  };

  return {
    name: "github",
    tools,
    promptGuidance: [
      "- tools.github.issues.listOlderThan({ owner, repo, olderThanDays, limit? }) returns open issues older than N days (auto-approved).",
      "- tools.github.issues.close({ owner, repo, issueNumber, issueTitle?, issueUrl?, reason? }) closes one issue (approval required).",
      "- For bulk close requests, use one run_code block: first list with listOlderThan, then call close once per issue.",
      "- In bulk close flows, continue processing remaining issues even if one close call is denied.",
      "- When closing from list results, pass issueTitle and issueUrl for richer approval context.",
    ].join("\n"),
    toolTypeDeclaration: [
      "github: {",
      "  issues: {",
      "    listOlderThan(input: { owner: string; repo: string; olderThanDays: number; limit?: number }): Promise<Array<{ number: number; title: string; state: string; createdAt: string; htmlUrl: string }>>;",
      "    close(input: { owner: string; repo: string; issueNumber: number; issueTitle?: string; issueUrl?: string; reason?: \"completed\" | \"not_planned\" | \"reopened\" }): Promise<{ number: number; title: string; state: string; createdAt: string; htmlUrl: string }>;",
      "  };",
      "};",
    ].join("\n"),
    formatApproval: (request) => {
      if (request.toolPath !== "github.issues.close") {
        return undefined;
      }
      const input = request.input as
        | {
            owner?: string;
            repo?: string;
            issueNumber?: number;
            issueTitle?: string;
            issueUrl?: string;
          }
        | undefined;

      const owner = input?.owner;
      const repo = input?.repo;
      const issueNumber = input?.issueNumber;
      if (!owner || !repo || typeof issueNumber !== "number") {
        return {
          title: "Close GitHub issue",
        };
      }

      const issueUrl = input?.issueUrl ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
      const issueLabel = `${owner}/${repo}#${issueNumber}`;
      const issueTitle = input?.issueTitle?.trim();

      return {
        title: `Close issue ${issueLabel}`,
        details: issueTitle ? `Issue: ${issueTitle}` : `Repository: ${owner}/${repo}`,
        link: issueUrl,
        inputPreview: issueTitle ? `${issueLabel} "${issueTitle}"` : issueLabel,
      };
    },
  };
}
