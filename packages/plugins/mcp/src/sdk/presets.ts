export interface McpPreset {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly url: string;
  readonly icon?: string;
}

export const mcpPresets: readonly McpPreset[] = [
  {
    id: "deepwiki",
    name: "DeepWiki",
    summary: "Search and read documentation from any GitHub repo.",
    url: "https://mcp.deepwiki.com/mcp",
    icon: "https://deepwiki.com/favicon.ico",
  },
  {
    id: "context7",
    name: "Context7",
    summary: "Up-to-date docs and code examples for any library.",
    url: "https://mcp.context7.com/mcp",
    icon: "https://context7.com/favicon.ico",
  },
  {
    id: "browserbase",
    name: "Browserbase",
    summary: "Cloud browser sessions for web scraping and automation.",
    url: "https://mcp.browserbase.com/mcp",
    icon: "https://www.browserbase.com/favicon.ico",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    summary: "Crawl and scrape websites into structured data.",
    url: "https://mcp.firecrawl.dev/mcp",
    icon: "https://www.firecrawl.dev/favicon.ico",
  },
  {
    id: "neon",
    name: "Neon",
    summary: "Serverless Postgres — branches, queries, and management.",
    url: "https://mcp.neon.tech/mcp",
    icon: "https://neon.tech/favicon/favicon.ico",
  },
  {
    id: "axiom",
    name: "Axiom",
    summary: "Query, analyze, and monitor your logs and event data.",
    url: "https://mcp.axiom.co/mcp",
    icon: "https://axiom.co/favicon.ico",
  },
];
