"use client";

import { useMemo } from "react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import type { ToolDescriptor } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { TypeSignature } from "./type-signature";

const codePlugin = createCodePlugin({
  themes: ["github-light", "github-dark"],
});

type FieldDocEntry = {
  path: string;
  required?: boolean;
  description?: string;
  example?: string;
  defaultValue?: string;
  deprecated?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toPreviewValue(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length > 96 ? `${trimmed.slice(0, 96)}...` : trimmed;
  }
  try {
    const serialized = JSON.stringify(value);
    if (!serialized) return undefined;
    return serialized.length > 96 ? `${serialized.slice(0, 96)}...` : serialized;
  } catch {
    return undefined;
  }
}

function parseSchemaJson(value: string): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return {};
  }
}

function collectSchemaFieldDocs(schema: Record<string, unknown>, options: { maxEntries?: number; maxDepth?: number } = {}): {
  entries: FieldDocEntry[];
  truncated: boolean;
} {
  const maxEntries = options.maxEntries ?? 28;
  const maxDepth = options.maxDepth ?? 4;
  const entries: FieldDocEntry[] = [];
  let truncated = false;

  const pushEntry = (entry: FieldDocEntry) => {
    if (entries.length >= maxEntries) {
      truncated = true;
      return;
    }
    entries.push(entry);
  };

  const walk = (node: unknown, prefix: string, depth: number) => {
    if (depth > maxDepth || truncated) return;
    const shape = asRecord(node);
    const required = new Set(
      Array.isArray(shape.required)
        ? shape.required.filter((value): value is string => typeof value === "string")
        : [],
    );

    const properties = asRecord(shape.properties);
    for (const [rawKey, child] of Object.entries(properties)) {
      if (truncated) break;
      const key = rawKey.trim();
      if (!key) continue;
      const childShape = asRecord(child);
      const path = prefix ? `${prefix}.${key}` : key;
      const description = typeof childShape.description === "string"
        ? childShape.description.trim()
        : "";
      const example = toPreviewValue(childShape.example);
      const defaultValue = toPreviewValue(childShape.default);
      const deprecated = childShape.deprecated === true;
      const isRequired = required.has(key);

      if (description || example || defaultValue || deprecated || isRequired) {
        pushEntry({
          path,
          ...(isRequired ? { required: true } : {}),
          ...(description ? { description } : {}),
          ...(example ? { example } : {}),
          ...(defaultValue ? { defaultValue } : {}),
          ...(deprecated ? { deprecated: true } : {}),
        });
      }

      walk(childShape, path, depth + 1);
    }
  };

  walk(schema, "", 0);
  const ordered = [...entries].sort((a, b) => {
    const requiredOrder = Number(Boolean(b.required)) - Number(Boolean(a.required));
    if (requiredOrder !== 0) return requiredOrder;
    return a.path.localeCompare(b.path);
  });
  return { entries: ordered, truncated };
}

function FieldDocsSection({
  label,
  entries,
  truncated,
}: {
  label: string;
  entries: FieldDocEntry[];
  truncated: boolean;
}) {
  if (entries.length === 0) return null;

  const collapsedByDefault = entries.length > 8 || truncated;

  return (
    <details className="group" open={!collapsedByDefault}>
      <summary className="mb-1 cursor-pointer select-none text-[10px] font-mono text-muted-foreground/70 group-open:mb-1">
        <span className="mr-2 text-[9px] uppercase tracking-wider text-muted-foreground/50">{label}</span>
        <span>{collapsedByDefault ? `show documented fields (${entries.length})` : `documented fields (${entries.length})`}</span>
      </summary>
      <div className="rounded-md border border-border/50 bg-muted/30 px-2.5 py-2 space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.path} className="text-[11px] leading-relaxed">
            <div className="font-mono text-foreground/85">
              {entry.path}
              {entry.required ? <span className="ml-1 text-[10px] text-emerald-600 dark:text-emerald-400">required</span> : null}
            </div>
            {entry.description ? <div className="text-muted-foreground">{entry.description}</div> : null}
            {entry.example ? <div className="font-mono text-muted-foreground/80">example: {entry.example}</div> : null}
            {entry.defaultValue ? <div className="font-mono text-muted-foreground/80">default: {entry.defaultValue}</div> : null}
            {entry.deprecated ? <div className="font-mono text-amber-600 dark:text-amber-400">deprecated</div> : null}
          </div>
        ))}
        {truncated ? (
          <div className="text-[10px] font-mono text-muted-foreground/70">Showing first {entries.length} documented fields...</div>
        ) : null}
      </div>
    </details>
  );
}

export function ToolDetail({
  tool,
  depth,
  loading,
}: {
  tool: ToolDescriptor;
  depth: number;
  loading?: boolean;
}) {
  const insetLeft = depth * 20 + 8 + 16 + 8;
  const description = tool.description?.trim() ?? "";
  const inputHint = tool.display?.input?.trim() ?? "";
  const outputHint = tool.display?.output?.trim() ?? "";
  const inputSchemaJson = tool.typing?.inputSchemaJson?.trim() ?? "";
  const outputSchemaJson = tool.typing?.outputSchemaJson?.trim() ?? "";
  const hasInputHint = inputHint.length > 0 && inputHint !== "{}" && inputHint.toLowerCase() !== "unknown";
  const hasOutputHint = outputHint.length > 0 && outputHint.toLowerCase() !== "unknown";
  const hasInputSchema = inputSchemaJson.length > 0 && inputSchemaJson !== "{}";
  const hasOutputSchema = outputSchemaJson.length > 0 && outputSchemaJson !== "{}";
  const showInputHint = hasInputHint && !hasInputSchema;
  const showOutputHint = hasOutputHint && !hasOutputSchema;
  const inputFieldDocs = useMemo(
    () => collectSchemaFieldDocs(parseSchemaJson(inputSchemaJson), { maxEntries: 24, maxDepth: 4 }),
    [inputSchemaJson],
  );
  const outputFieldDocs = useMemo(
    () => collectSchemaFieldDocs(parseSchemaJson(outputSchemaJson), { maxEntries: 24, maxDepth: 4 }),
    [outputSchemaJson],
  );
  const hasInputFieldDocs = inputFieldDocs.entries.length > 0;
  const hasOutputFieldDocs = outputFieldDocs.entries.length > 0;
  const showInputRawSchema = hasInputSchema && !hasInputFieldDocs;
  const showOutputRawSchema = hasOutputSchema && !hasOutputFieldDocs;
  const hasDetails = description.length > 0
    || showInputHint
    || showOutputHint
    || hasInputSchema
    || hasOutputSchema
    || inputFieldDocs.entries.length > 0
    || outputFieldDocs.entries.length > 0;
  const showLoading = Boolean(loading);

  return (
    <div className="space-y-2.5 pb-3 pt-1 pr-2" style={{ paddingLeft: insetLeft }}>
      {showLoading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-3.5 w-64" />

          <div>
            <p className="mb-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50">
              Arguments
            </p>
            <Skeleton className="h-16 w-full rounded-md" />
          </div>

          <div>
            <p className="mb-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground/50">
              Returns
            </p>
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
        </div>
      ) : null}

      {description && (
        <div className="tool-description text-[12px] leading-relaxed text-muted-foreground">
          <Streamdown plugins={{ code: codePlugin }}>{description}</Streamdown>
        </div>
      )}

      {showInputHint && <TypeSignature raw={inputHint} label="Arguments" />}
      {showOutputHint && <TypeSignature raw={outputHint} label="Returns" />}

      {showInputRawSchema ? <TypeSignature raw={inputSchemaJson} label="Input Schema" /> : null}
      {showOutputRawSchema ? <TypeSignature raw={outputSchemaJson} label="Output Schema" /> : null}
      {hasInputSchema ? (
        <FieldDocsSection
          label="Input Field Docs"
          entries={inputFieldDocs.entries}
          truncated={inputFieldDocs.truncated}
        />
      ) : null}
      {hasOutputSchema ? (
        <FieldDocsSection
          label="Output Field Docs"
          entries={outputFieldDocs.entries}
          truncated={outputFieldDocs.truncated}
        />
      ) : null}
      {hasInputSchema && hasInputFieldDocs ? (
        <details>
          <summary className="cursor-pointer select-none text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
            Show Raw Input Schema
          </summary>
          <div className="mt-1">
            <TypeSignature raw={inputSchemaJson} label="Input Schema" />
          </div>
        </details>
      ) : null}
      {hasOutputSchema && hasOutputFieldDocs ? (
        <details>
          <summary className="cursor-pointer select-none text-[10px] font-mono uppercase tracking-wider text-muted-foreground/60">
            Show Raw Output Schema
          </summary>
          <div className="mt-1">
            <TypeSignature raw={outputSchemaJson} label="Output Schema" />
          </div>
        </details>
      ) : null}

      {!showLoading && !hasDetails ? (
        <p className="text-[11px] text-muted-foreground/60">No description or type signatures available yet.</p>
      ) : null}
    </div>
  );
}
