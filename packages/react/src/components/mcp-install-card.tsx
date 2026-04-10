import { useEffect, useState } from "react";
import CursorIcon from "@lobehub/icons/es/Cursor/components/Mono";
import ClaudeIcon from "@lobehub/icons/es/Claude/components/Color";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Text";
import { Button } from "./button";
import {
  CardStack,
  CardStackHeader,
  CardStackContent,
  CardStackEntryField,
} from "./card-stack";
import { CodeBlock } from "./code-block";
import { cn } from "../lib/utils";
import { useScopeInfo } from "../api/scope-context";

type TransportMode = "stdio" | "http";

const SUPPORTED_AGENTS = [
  { key: "cursor", label: "Cursor", Icon: CursorIcon },
  { key: "claude", label: "Claude", Icon: ClaudeIcon },
  { key: "opencode", label: "OpenCode", Icon: OpenCodeIcon },
] as const;

const isDev = import.meta.env.DEV;
const isLocal =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

export function McpInstallCard(props: { className?: string }) {
  const showStdio = isLocal;
  const [mode, setMode] = useState<TransportMode>(showStdio ? "stdio" : "http");
  const [origin, setOrigin] = useState<string | null>(null);
  const scopeInfo = useScopeInfo();

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const scopeFlag = scopeInfo.dir
    ? ` --scope ${JSON.stringify(scopeInfo.dir)}`
    : "";

  const command =
    mode === "stdio"
      ? isDev
        ? `npx add-mcp "bun run dev:cli mcp${scopeFlag}" --name "executor"`
        : `npx add-mcp "executor mcp${scopeFlag}" --name "executor"`
      : origin
        ? `npx add-mcp "${origin}/mcp" --transport http --name "executor"`
        : 'npx add-mcp "<this-server>/mcp" --transport http --name "executor"';

  const description =
    mode === "stdio"
      ? "Starts executor as a local stdio MCP server. Best for CLI agents like Claude Code."
      : "Connect to executor as a remote MCP server over streamable HTTP.";

  const stdioHint =
    mode === "stdio"
      ? isDev
        ? "Uses the repo-local dev CLI. Run from the repository root."
        : "Requires the executor CLI on your PATH."
      : undefined;

  return (
    <CardStack className={props.className}>
      <CardStackHeader
        rightSlot={
          <div className="flex shrink-0 items-center gap-2 text-muted-foreground">
            <div className="group/agents flex items-center">
              {SUPPORTED_AGENTS.map(({ key, label, Icon }, index) => (
                <span
                  key={key}
                  title={label}
                  aria-label={label}
                  style={{ zIndex: SUPPORTED_AGENTS.length - index }}
                  className={cn(
                    "flex h-6 items-center justify-center rounded-md border border-border/60 bg-background px-1.5 transition-[margin] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]",
                    index > 0 && "-ml-2 group-hover/agents:ml-1",
                  )}
                >
                  <Icon size={14} />
                </span>
              ))}
            </div>
            <span className="text-[12px] text-muted-foreground/70">
              and more
            </span>
          </div>
        }
      >
        Connect your agent
      </CardStackHeader>
      <CardStackContent>
        <CardStackEntryField hint={stdioHint}>
          <div className="flex items-start justify-between gap-3">
            <p className="text-[13px] text-muted-foreground">{description}</p>
            {showStdio && (
              <div className="inline-flex shrink-0 rounded-lg border border-border bg-background/70 p-1">
                {(
                  [
                    { key: "http", label: "Remote HTTP" },
                    { key: "stdio", label: "Standard I/O" },
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.key}
                    type="button"
                    variant={mode === opt.key ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setMode(opt.key)}
                    className="rounded-md px-3 py-1.5"
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <CodeBlock code={command} lang="bash" />
        </CardStackEntryField>
      </CardStackContent>
    </CardStack>
  );
}
