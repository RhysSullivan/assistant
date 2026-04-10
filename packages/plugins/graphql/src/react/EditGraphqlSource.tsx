import { useState } from "react";
import { useAtomValue, useAtomSet, useAtomRefresh, Result } from "@effect-atom/atom-react";
import { secretsAtom } from "@executor/react/api/atoms";
import { graphqlSourceAtom, updateGraphqlSource } from "./atoms";
import { useScope } from "@executor/react/api/scope-context";
import { Button } from "@executor/react/components/button";
import { Input } from "@executor/react/components/input";
import { Label } from "@executor/react/components/label";
import { Badge } from "@executor/react/components/badge";
import { SecretPicker, type SecretPickerSecret } from "@executor/react/plugins/secret-picker";
import type { StoredSourceSchemaType } from "../sdk/stored-source";
import type { HeaderValue } from "../sdk/types";

// ---------------------------------------------------------------------------
// Editable header row state
// ---------------------------------------------------------------------------

type HeaderRowState = {
  readonly name: string;
  readonly secretId: string | null;
  readonly prefix?: string;
};

function headerValueToState(name: string, value: HeaderValue): HeaderRowState {
  if (typeof value === "string") {
    return { name, secretId: null };
  }
  return { name, secretId: value.secretId, prefix: value.prefix };
}

function headersFromState(
  entries: readonly HeaderRowState[],
): Record<string, HeaderValue> {
  const result: Record<string, HeaderValue> = {};
  for (const entry of entries) {
    const name = entry.name.trim();
    if (!name || !entry.secretId) continue;
    result[name] = {
      secretId: entry.secretId,
      ...(entry.prefix ? { prefix: entry.prefix } : {}),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Header row
// ---------------------------------------------------------------------------

function HeaderRow(props: {
  state: HeaderRowState;
  onChange: (update: Partial<HeaderRowState>) => void;
  onRemove: () => void;
  secrets: readonly SecretPickerSecret[];
}) {
  const { state, onChange, onRemove, secrets } = props;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Header</Label>
        <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</Label>
          <Input
            value={state.name}
            onChange={(e) => onChange({ name: (e.target as HTMLInputElement).value })}
            placeholder="Authorization"
            className="h-8 text-xs font-mono"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Prefix</Label>
          <Input
            value={state.prefix ?? ""}
            onChange={(e) =>
              onChange({
                prefix: (e.target as HTMLInputElement).value || undefined,
              })
            }
            placeholder="Bearer "
            className="h-8 text-xs font-mono"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Secret</Label>
        <SecretPicker
          value={state.secretId}
          onSelect={(id) => onChange({ secretId: id })}
          secrets={secrets}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit form — rendered once the source has loaded
// ---------------------------------------------------------------------------

function EditForm(props: {
  sourceId: string;
  initial: StoredSourceSchemaType;
  secretList: readonly SecretPickerSecret[];
  onSave: () => void;
}) {
  const scopeId = useScope();
  const doUpdate = useAtomSet(updateGraphqlSource, { mode: "promise" });
  const refreshSource = useAtomRefresh(graphqlSourceAtom(scopeId, props.sourceId));

  const [endpoint, setEndpoint] = useState(props.initial.config.endpoint);
  const [headers, setHeaders] = useState<HeaderRowState[]>(() =>
    Object.entries(props.initial.config.headers ?? {}).map(([name, value]) =>
      headerValueToState(name, value),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const updateHeader = (index: number, update: Partial<HeaderRowState>) => {
    setHeaders((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...update } : row)),
    );
    setDirty(true);
  };

  const removeHeader = (index: number) => {
    setHeaders((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const addHeader = () => {
    setHeaders((prev) => [...prev, { name: "", secretId: null }]);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await doUpdate({
        path: { scopeId, namespace: props.sourceId },
        payload: {
          endpoint: endpoint.trim() || undefined,
          headers: headersFromState(headers),
        },
      });
      refreshSource();
      setDirty(false);
      props.onSave();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update source");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Edit GraphQL Source</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Update the endpoint and authentication headers for this source.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-card-foreground">{props.sourceId}</p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          GraphQL
        </Badge>
      </div>

      {/* Endpoint */}
      <section className="space-y-2">
        <Label>Endpoint</Label>
        <Input
          value={endpoint}
          onChange={(e) => {
            setEndpoint((e.target as HTMLInputElement).value);
            setDirty(true);
          }}
          placeholder="https://api.example.com/graphql"
          className="font-mono text-sm"
        />
      </section>

      {/* Headers */}
      <section className="space-y-2.5">
        <Label>Headers</Label>
        {headers.map((row, i) => (
          <HeaderRow
            key={i}
            state={row}
            onChange={(update) => updateHeader(i, update)}
            onRemove={() => removeHeader(i)}
            secrets={props.secretList}
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          className="w-full border-dashed"
          onClick={addHeader}
        >
          + Add header
        </Button>
      </section>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{error}</p>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onClick={props.onSave}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EditGraphqlSource(props: {
  sourceId: string;
  onSave: () => void;
}) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(graphqlSourceAtom(scopeId, props.sourceId));
  const secrets = useAtomValue(secretsAtom(scopeId));

  const secretList: readonly SecretPickerSecret[] = Result.match(secrets, {
    onInitial: () => [] as SecretPickerSecret[],
    onFailure: () => [] as SecretPickerSecret[],
    onSuccess: ({ value }) =>
      value.map((s) => ({
        id: s.id,
        name: s.name,
        provider: s.provider ? String(s.provider) : undefined,
      })),
  });

  if (!Result.isSuccess(sourceResult) || !sourceResult.value) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Edit GraphQL Source</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">Loading configuration…</p>
        </div>
      </div>
    );
  }

  return (
    <EditForm
      sourceId={props.sourceId}
      initial={sourceResult.value}
      secretList={secretList}
      onSave={props.onSave}
    />
  );
}
