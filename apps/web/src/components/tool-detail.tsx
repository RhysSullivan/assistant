import { useState } from "react";
import { useAtomValue, toolSchemaAtom, Result, ScopeId, ToolId } from "@executor/react";
import { Markdown } from "./markdown";

// ---------------------------------------------------------------------------
// Schema panel
// ---------------------------------------------------------------------------

function SchemaPanel(props: { title: string; schema: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const json = JSON.stringify(props.schema, null, 2);
  const lines = json.split("\n");
  const isLong = lines.length > 20;

  return (
    <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
      <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
        {props.title}
      </div>
      <div className="relative">
        <pre
          className={[
            "overflow-x-auto p-3 text-xs font-mono text-foreground/80 leading-relaxed",
            !expanded && isLong ? "max-h-[20rem] overflow-hidden" : "",
          ].join(" ")}
        >
          {json}
        </pre>
        {isLong && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 flex justify-center bg-gradient-to-t from-card/90 to-transparent pb-2 pt-8">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Show all ({lines.length} lines)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton(props: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(props.text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="size-6 shrink-0 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground transition-colors"
      title="Copy tool ID"
    >
      {copied ? (
        <svg viewBox="0 0 16 16" className="size-3.5">
          <path d="M3 8l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="size-3.5">
          <rect x="5" y="5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M3 11V3h8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ToolDetail
// ---------------------------------------------------------------------------

export function ToolDetail(props: {
  toolId: string;
  toolName: string;
  toolDescription?: string;
  scopeId: ScopeId;
}) {
  const schema = useAtomValue(
    toolSchemaAtom(props.scopeId, props.toolId as ToolId),
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="flex items-start gap-3 px-5 py-3.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <svg viewBox="0 0 16 16" className="size-4">
              <path
                d="M4 2h8l1 3H3l1-3zM3 6h10v8H3V6z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-foreground font-mono">
                {props.toolName}
              </h3>
              <CopyButton text={props.toolId} />
            </div>
            {props.toolDescription && (
              <div className="mt-1">
                <Markdown>{props.toolDescription}</Markdown>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Schema content */}
      <div className="flex-1 overflow-y-auto">
        {Result.match(schema, {
          onInitial: () => (
            <div className="p-5 text-sm text-muted-foreground">Loading schema…</div>
          ),
          onFailure: () => (
            <div className="p-5 text-sm text-destructive">Failed to load schema</div>
          ),
          onSuccess: ({ value }) => (
            <div className="space-y-4 px-5 py-4">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {value.inputSchema ? (
                  <SchemaPanel title="Input Schema" schema={value.inputSchema} />
                ) : (
                  <div className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-[13px] text-muted-foreground/40">
                    No input schema
                  </div>
                )}
                {value.outputSchema ? (
                  <SchemaPanel title="Output Schema" schema={value.outputSchema} />
                ) : (
                  <div className="rounded-lg border border-border bg-card/60 px-3 py-6 text-center text-[13px] text-muted-foreground/40">
                    No output schema
                  </div>
                )}
              </div>
            </div>
          ),
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

export function ToolDetailEmpty(props: { hasTools: boolean }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-sm font-medium text-foreground/70">
          {props.hasTools ? "Select a tool" : "No tools available"}
        </p>
        {props.hasTools && (
          <p className="mt-1 text-xs text-muted-foreground">
            Choose from the list or press <kbd className="rounded border border-border bg-muted px-1 py-px text-[10px]">/</kbd> to search.
          </p>
        )}
      </div>
    </div>
  );
}
