export function sourceLabel(source?: string): string {
  if (!source) return "built-in";
  const idx = source.indexOf(":");
  return idx >= 0 ? source.slice(idx + 1) : source;
}

export function sourceType(source?: string): string {
  if (!source) return "local";
  const idx = source.indexOf(":");
  return idx >= 0 ? source.slice(0, idx) : "local";
}

export function displaySourceName(name: string): string {
  const parts = name.split(/[-_.]+/).filter(Boolean);
  if (parts.length === 0) return name;

  const deduped = parts.filter((part, index, all) => {
    if (index === 0) return true;
    return part.toLowerCase() !== all[index - 1]?.toLowerCase();
  });

  const tokenMap: Record<string, string> = {
    api: "API",
    oauth: "OAuth",
    graphql: "GraphQL",
    mcp: "MCP",
    github: "GitHub",
  };

  return deduped
    .map((token) => {
      const lower = token.toLowerCase();
      if (tokenMap[lower]) return tokenMap[lower];
      return `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
    })
    .join(" ");
}
