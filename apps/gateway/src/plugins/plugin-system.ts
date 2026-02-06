import type { ToolTree } from "@openassistant/core";
import type { ApprovalRequest } from "@openassistant/core";

export interface ApprovalPresentation {
  title?: string;
  details?: string;
  link?: string;
  inputPreview?: string;
}

export interface GatewayPlugin {
  name: string;
  tools: ToolTree;
  promptGuidance: string;
  toolTypeDeclaration: string;
  formatApproval?: (request: ApprovalRequest) => ApprovalPresentation | undefined;
}

export interface ToolingBundle {
  tools: ToolTree;
  promptGuidance: string;
  toolTypeDeclarations: string;
  formatApproval: (request: ApprovalRequest) => ApprovalPresentation;
  pluginNames: string[];
}

export function composePlugins(plugins: Array<GatewayPlugin>): ToolingBundle {
  const mergedTools = plugins.reduce<Record<string, unknown>>((acc, plugin) => {
    mergeToolTrees(acc, plugin.tools, plugin.name);
    return acc;
  }, {});

  const promptGuidance = plugins
    .map((plugin) => plugin.promptGuidance.trim())
    .filter((value) => value.length > 0)
    .join("\n");

  const toolTypeDeclarations = [
    "declare const tools: {",
    ...plugins.flatMap((plugin) => indent(plugin.toolTypeDeclaration).split("\n")),
    "};",
  ].join("\n");

  return {
    tools: mergedTools as ToolTree,
    promptGuidance,
    toolTypeDeclarations,
    formatApproval: (request) => {
      for (const plugin of plugins) {
        if (!plugin.formatApproval) {
          continue;
        }
        const formatted = plugin.formatApproval(request);
        if (formatted) {
          return {
            ...(request.inputPreview ? { inputPreview: request.inputPreview } : {}),
            ...formatted,
          };
        }
      }
      return {
        ...(request.inputPreview ? { inputPreview: request.inputPreview } : {}),
      };
    },
    pluginNames: plugins.map((plugin) => plugin.name),
  };
}

function mergeToolTrees(target: Record<string, unknown>, source: ToolTree, pluginName: string): void {
  for (const [key, sourceNode] of Object.entries(source)) {
    const sourceIsTool = isToolNode(sourceNode);
    const targetNode = target[key];

    if (targetNode === undefined) {
      if (sourceIsTool) {
        target[key] = sourceNode;
        continue;
      }

      const nested: Record<string, unknown> = {};
      target[key] = nested;
      mergeToolTrees(nested, sourceNode as ToolTree, pluginName);
      continue;
    }

    const targetIsTool = isToolNode(targetNode);

    if (sourceIsTool || targetIsTool) {
      throw new Error(`Plugin conflict on tool path '${key}' while loading '${pluginName}'.`);
    }

    mergeToolTrees(targetNode as Record<string, unknown>, sourceNode as ToolTree, pluginName);
  }
}

function isToolNode(value: unknown): boolean {
  return typeof value === "object" && value !== null && "_tag" in value;
}

function indent(value: string): string {
  return value
    .trim()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}
