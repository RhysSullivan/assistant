import { defineExecutorConfig } from "@executor-js/sdk";
import { openApiPlugin } from "@executor-js/plugin-openapi";
import { mcpPlugin } from "@executor-js/plugin-mcp";
import { graphqlPlugin } from "@executor-js/plugin-graphql";
import { workosVaultPlugin } from "@executor-js/plugin-workos-vault";

// ---------------------------------------------------------------------------
// Executor config for CLI schema generation.
//
// The CLI reads `plugins` + `dialect` to produce a drizzle schema file.
// Plugin credentials are stubs — the CLI only reads `plugin.schema`,
// never calls the plugin at runtime.
// ---------------------------------------------------------------------------

export default defineExecutorConfig({
  dialect: "pg",
  plugins: [
    openApiPlugin(),
    mcpPlugin({ dangerouslyAllowStdioMCP: false }),
    graphqlPlugin(),
    workosVaultPlugin({
      credentials: { apiKey: "", clientId: "" },
    }),
  ],
});
