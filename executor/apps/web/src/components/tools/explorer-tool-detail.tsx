"use client";

import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import type { ToolDescriptor } from "@/lib/types";
import { TypeSignature } from "./explorer-type-signature";

const codePlugin = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

export function ToolDetail({ tool, depth }: { tool: ToolDescriptor; depth: number }) {
  const insetLeft = depth * 20 + 8 + 16 + 8;

  return (
    <div className="space-y-2.5 pb-3 pt-1 pr-2" style={{ paddingLeft: insetLeft }}>
      {tool.description && (
        <div className="tool-description text-[12px] leading-relaxed text-muted-foreground">
          <Streamdown plugins={{ code: codePlugin }}>{tool.description}</Streamdown>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70">
          {tool.path}
        </span>
        {tool.source && (
          <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70">
            source: {tool.source}
          </span>
        )}
        {tool.operationId && (
          <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/70">
            op: {tool.operationId}
          </span>
        )}
      </div>

      {tool.argsType && <TypeSignature raw={tool.argsType} label="Arguments" />}
      {tool.returnsType && <TypeSignature raw={tool.returnsType} label="Returns" />}
    </div>
  );
}
