import { Effect, Layer } from "effect";
import {
  McpHandlers,
  McpExtensionService,
} from "@executor/plugin-mcp/api";
import { ExecutorService } from "../services/executor";

// Wire McpExtensionService from the executor's mcp extension
const McpExtensionLive = Layer.effect(
  McpExtensionService,
  Effect.map(ExecutorService, (executor) => executor.mcp),
);

export const McpSourceHandlersLive = Layer.provide(
  McpHandlers,
  McpExtensionLive,
);
