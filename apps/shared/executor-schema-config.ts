import { defineExecutorConfig } from "@executor/sdk";
import { googleDiscoveryPlugin } from "@executor/plugin-google-discovery";
import { graphqlPlugin } from "@executor/plugin-graphql";
import { mcpPlugin } from "@executor/plugin-mcp";
import { openApiPlugin } from "@executor/plugin-openapi";
import { workosVaultPlugin } from "@executor/plugin-workos-vault";

export const executorSchemaConfig = (options: {
  readonly dialect: "pg" | "sqlite";
  readonly allowStdioMcp: boolean;
  readonly googleDiscovery?: boolean;
  readonly workosVault?: boolean;
}) =>
  defineExecutorConfig({
    dialect: options.dialect,
    plugins: [
      openApiPlugin(),
      mcpPlugin({ dangerouslyAllowStdioMCP: options.allowStdioMcp }),
      ...(options.googleDiscovery ? [googleDiscoveryPlugin()] : []),
      graphqlPlugin(),
      ...(options.workosVault
        ? [workosVaultPlugin({ credentials: { apiKey: "", clientId: "" } })]
        : []),
    ],
  });
