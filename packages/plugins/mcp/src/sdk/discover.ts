// ---------------------------------------------------------------------------
// MCP tool discovery — connect to an MCP server and list its tools
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import type { McpConnector } from "./connection";
import { McpToolDiscoveryError } from "./errors";
import {
  extractManifestFromListToolsResult,
  isListToolsResult,
  type McpToolManifest,
} from "./manifest";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Connect to an MCP server and discover all available tools.
 * Returns the parsed manifest containing server metadata and tool entries.
 */
export const discoverTools = (
  connector: McpConnector,
): Effect.Effect<McpToolManifest, McpToolDiscoveryError> =>
  Effect.gen(function* () {
    // Acquire connection
    const connection = yield* connector.pipe(
      Effect.mapError(
        () =>
          new McpToolDiscoveryError({
            stage: "connect",
            message: "Failed connecting to MCP server",
          }),
      ),
    );

    // List tools
    const listResult = yield* Effect.tryPromise({
      try: () => connection.client.listTools(),
      catch: () =>
        new McpToolDiscoveryError({
          stage: "list_tools",
          message: "Failed listing MCP tools",
        }),
    });

    if (!isListToolsResult(listResult)) {
      yield* Effect.ignore(
        Effect.tryPromise({
          try: () => connection.close(),
          catch: () =>
            new McpToolDiscoveryError({
              stage: "list_tools",
              message: "Failed closing MCP connection",
            }),
        }),
      );
      return yield* new McpToolDiscoveryError({
        stage: "list_tools",
        message: "MCP listTools response did not match the expected schema",
      });
    }

    const manifest = extractManifestFromListToolsResult(listResult, {
      serverInfo: connection.client.getServerVersion?.(),
    });

    // Close the connection after discovery
    yield* Effect.ignore(
      Effect.tryPromise({
        try: () => connection.close(),
        catch: () =>
          new McpToolDiscoveryError({
            stage: "list_tools",
            message: "Failed closing MCP connection",
          }),
      }),
    );

    return manifest;
  });
