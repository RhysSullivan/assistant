# @executor/plugin-mcp

Register [Model Context Protocol](https://modelcontextprotocol.io) servers as tool sources for an executor. Supports both stdio-launched servers and remote (HTTP) servers, with optional OAuth.

## Install

```sh
bun add @executor/sdk @executor/plugin-mcp
# or
npm install @executor/sdk @executor/plugin-mcp
```

## Usage

```ts
import { createExecutor } from "@executor/sdk";
import { mcpPlugin } from "@executor/plugin-mcp";

const executor = await createExecutor({
  scope: { name: "my-app" },
  plugins: [mcpPlugin()] as const,
});

// Remote MCP server
await executor.mcp.addSource({
  transport: "remote",
  name: "Context7",
  endpoint: "https://mcp.context7.com/mcp",
});

// Stdio MCP server
await executor.mcp.addSource({
  transport: "stdio",
  name: "My Server",
  command: "npx",
  args: ["-y", "@my/mcp-server"],
});

// Every MCP tool is now part of the unified catalog
const tools = await executor.tools.list();

const result = await executor.tools.invoke(
  "context7.searchLibraries",
  { query: "effect-ts" },
  { onElicitation: "accept-all" },
);
```

## Using with Effect

If you're building on `@executor/sdk` (the raw Effect entry), import this plugin from its `/core` subpath instead:

```ts
import { mcpPlugin } from "@executor/plugin-mcp";
```

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
