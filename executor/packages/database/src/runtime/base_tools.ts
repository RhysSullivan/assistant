import type { ToolDefinition } from "../../../core/src/types";
import {
  catalogNamespacesInputJsonSchema,
  catalogNamespacesOutputJsonSchema,
  catalogToolsInputJsonSchema,
  catalogToolsOutputJsonSchema,
  discoverInputJsonSchema,
  discoverOutputJsonSchema,
} from "./discovery_tool_contracts";
import {
  fsMkdirInputJsonSchema,
  fsMkdirOutputJsonSchema,
  fsReadInputJsonSchema,
  fsReadOutputJsonSchema,
  fsReaddirInputJsonSchema,
  fsReaddirOutputJsonSchema,
  fsRemoveInputJsonSchema,
  fsRemoveOutputJsonSchema,
  fsStatInputJsonSchema,
  fsStatOutputJsonSchema,
  fsWriteInputJsonSchema,
  fsWriteOutputJsonSchema,
  kvDeleteInputJsonSchema,
  kvDeleteOutputJsonSchema,
  kvGetInputJsonSchema,
  kvGetOutputJsonSchema,
  kvListInputJsonSchema,
  kvListOutputJsonSchema,
  kvSetInputJsonSchema,
  kvSetOutputJsonSchema,
  sqliteQueryInputJsonSchema,
  sqliteQueryOutputJsonSchema,
  storageCloseInputJsonSchema,
  storageCloseOutputJsonSchema,
  storageDeleteInputJsonSchema,
  storageDeleteOutputJsonSchema,
  storageListInputJsonSchema,
  storageListOutputJsonSchema,
  storageOpenInputJsonSchema,
  storageOpenOutputJsonSchema,
} from "./storage_tool_contracts";

export const baseTools = new Map<string, ToolDefinition>();

function registerSystemTool(
  path: string,
  description: string,
  typing: {
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  },
  approval: "auto" | "required" = "auto",
) {
  baseTools.set(path, {
    path,
    source: "system",
    approval,
    description,
    typing,
    run: async () => {
      throw new Error(`${path} is handled by the server tool invocation pipeline`);
    },
  });
}

// Built-in system tools are resolved server-side.
// Their execution is handled in the Convex tool invocation pipeline.
registerSystemTool(
  "discover",
  "Search available tools by keyword. Returns compact input/output hints by default; set includeSchemas=true for exact JSON Schemas.",
  {
    inputSchema: discoverInputJsonSchema,
    outputSchema: discoverOutputJsonSchema,
  },
);

registerSystemTool(
  "catalog.namespaces",
  "List available tool namespaces with counts and sample callable paths.",
  {
    inputSchema: catalogNamespacesInputJsonSchema,
    outputSchema: catalogNamespacesOutputJsonSchema,
  },
);

registerSystemTool(
  "catalog.tools",
  "List tools with compact hints by default. Supports namespace/query filters and optional includeSchemas for exact JSON Schemas.",
  {
    inputSchema: catalogToolsInputJsonSchema,
    outputSchema: catalogToolsOutputJsonSchema,
  },
);

registerSystemTool(
  "storage.open",
  "Open an existing storage instance or create a new one when instanceId is omitted.",
  {
    inputSchema: storageOpenInputJsonSchema,
    outputSchema: storageOpenOutputJsonSchema,
  },
);

registerSystemTool(
  "storage.list",
  "List accessible storage instances for the current workspace context.",
  {
    inputSchema: storageListInputJsonSchema,
    outputSchema: storageListOutputJsonSchema,
  },
);

registerSystemTool(
  "storage.close",
  "Mark a storage instance as closed without deleting its contents.",
  {
    inputSchema: storageCloseInputJsonSchema,
    outputSchema: storageCloseOutputJsonSchema,
  },
);

registerSystemTool(
  "storage.delete",
  "Delete a storage instance and its backing data.",
  {
    inputSchema: storageDeleteInputJsonSchema,
    outputSchema: storageDeleteOutputJsonSchema,
  },
);

registerSystemTool(
  "fs.read",
  "Read a file from a storage instance.",
  {
    inputSchema: fsReadInputJsonSchema,
    outputSchema: fsReadOutputJsonSchema,
  },
);

registerSystemTool(
  "fs.write",
  "Write file contents into a storage instance.",
  {
    inputSchema: fsWriteInputJsonSchema,
    outputSchema: fsWriteOutputJsonSchema,
  },
);

registerSystemTool(
  "fs.readdir",
  "List directory entries in a storage instance.",
  {
    inputSchema: fsReaddirInputJsonSchema,
    outputSchema: fsReaddirOutputJsonSchema,
  },
);

registerSystemTool(
  "fs.stat",
  "Get metadata for a filesystem path in storage.",
  {
    inputSchema: fsStatInputJsonSchema,
    outputSchema: fsStatOutputJsonSchema,
  },
);

registerSystemTool(
  "fs.mkdir",
  "Create a directory in a storage instance.",
  {
    inputSchema: fsMkdirInputJsonSchema,
    outputSchema: fsMkdirOutputJsonSchema,
  },
);

registerSystemTool(
  "fs.remove",
  "Remove a file or directory from a storage instance.",
  {
    inputSchema: fsRemoveInputJsonSchema,
    outputSchema: fsRemoveOutputJsonSchema,
  },
);

registerSystemTool(
  "kv.get",
  "Read a key-value entry from a storage instance.",
  {
    inputSchema: kvGetInputJsonSchema,
    outputSchema: kvGetOutputJsonSchema,
  },
);

registerSystemTool(
  "kv.set",
  "Write a key-value entry into a storage instance.",
  {
    inputSchema: kvSetInputJsonSchema,
    outputSchema: kvSetOutputJsonSchema,
  },
);

registerSystemTool(
  "kv.list",
  "List key-value entries by prefix from a storage instance.",
  {
    inputSchema: kvListInputJsonSchema,
    outputSchema: kvListOutputJsonSchema,
  },
);

registerSystemTool(
  "kv.delete",
  "Delete a key-value entry from a storage instance.",
  {
    inputSchema: kvDeleteInputJsonSchema,
    outputSchema: kvDeleteOutputJsonSchema,
  },
);

registerSystemTool(
  "sqlite.query",
  "Run SQL queries against the storage instance database.",
  {
    inputSchema: sqliteQueryInputJsonSchema,
    outputSchema: sqliteQueryOutputJsonSchema,
  },
);
