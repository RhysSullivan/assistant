import type { Source } from "@executor-v3/react";

type SourceTemplateBase = {
  id: string;
  name: string;
  summary: string;
  endpoint: string;
};

export type OpenApiSourceTemplate = SourceTemplateBase & {
  kind: "openapi";
  specUrl: string;
};

export type NonOpenApiSourceTemplate = SourceTemplateBase & {
  kind: Exclude<Source["kind"], "openapi" | "internal">;
};

export type SourceTemplate = OpenApiSourceTemplate | NonOpenApiSourceTemplate;

export const sourceTemplates: ReadonlyArray<SourceTemplate> = [
  {
    id: "deepwiki-mcp",
    name: "DeepWiki MCP",
    summary: "Repository docs and knowledge graphs via MCP.",
    kind: "mcp",
    endpoint: "https://mcp.deepwiki.com/mcp",
  },
  {
    id: "axiom-mcp",
    name: "Axiom MCP",
    summary: "Query, stream, and analyze logs, traces, and event data.",
    kind: "mcp",
    endpoint: "https://mcp.axiom.co/mcp",
  },
  {
    id: "neon-mcp",
    name: "Neon MCP",
    summary: "Manage Postgres databases, branches, and queries via MCP.",
    kind: "mcp",
    endpoint: "https://mcp.neon.tech/mcp",
  },
  {
    id: "neon-api",
    name: "Neon API",
    summary: "Projects, branches, endpoints, databases, and API keys.",
    kind: "openapi",
    endpoint: "https://console.neon.tech/api/v2",
    specUrl: "https://neon.com/api_spec/release/v2.json",
  },
  {
    id: "github-rest",
    name: "GitHub REST API",
    summary: "Repos, issues, pull requests, actions, and org settings.",
    kind: "openapi",
    endpoint: "https://api.github.com",
    specUrl: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml",
  },
  {
    id: "github-graphql",
    name: "GitHub GraphQL",
    summary: "Issues, pull requests, discussions, and repository objects via GraphQL.",
    kind: "graphql",
    endpoint: "https://api.github.com/graphql",
  },
  {
    id: "gitlab-graphql",
    name: "GitLab GraphQL",
    summary: "Projects, merge requests, issues, CI pipelines, and users.",
    kind: "graphql",
    endpoint: "https://gitlab.com/api/graphql",
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    summary: "Models, files, responses, and fine-tuning.",
    kind: "openapi",
    endpoint: "https://api.openai.com/v1",
    specUrl: "https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml",
  },
  {
    id: "vercel-api",
    name: "Vercel API",
    summary: "Deployments, projects, domains, and environments.",
    kind: "openapi",
    endpoint: "https://api.vercel.com",
    specUrl: "https://openapi.vercel.sh",
  },
  {
    id: "stripe-api",
    name: "Stripe API",
    summary: "Payments, billing, subscriptions, and invoices.",
    kind: "openapi",
    endpoint: "https://api.stripe.com",
    specUrl: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
  },
  {
    id: "linear-graphql",
    name: "Linear GraphQL",
    summary: "Issues, teams, cycles, and projects.",
    kind: "graphql",
    endpoint: "https://api.linear.app/graphql",
  },
  {
    id: "monday-graphql",
    name: "Monday GraphQL",
    summary: "Boards, items, updates, users, and workspace metadata.",
    kind: "graphql",
    endpoint: "https://api.monday.com/v2",
  },
  {
    id: "anilist-graphql",
    name: "AniList GraphQL",
    summary: "Anime, manga, characters, media lists, and recommendations.",
    kind: "graphql",
    endpoint: "https://graphql.anilist.co",
  },
];
