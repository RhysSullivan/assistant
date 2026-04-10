import { useState } from "react";
import { useAtomValue, useAtomSet, useAtomRefresh, Result } from "@effect-atom/atom-react";
import { secretsAtom } from "@executor/react/api/atoms";
import { openApiSourceAtom, updateOpenApiSource } from "./atoms";
import { useScope } from "@executor/react/api/scope-context";
import { Button } from "@executor/react/components/button";
import { Input } from "@executor/react/components/input";
import { Label } from "@executor/react/components/label";
import { Badge } from "@executor/react/components/badge";
import { type SecretPickerSecret } from "@executor/react/plugins/secret-picker";
import { CustomHeaderRow, matchPresetKey, type CustomHeaderState } from "./custom-header-row";
import type { StoredSourceSchemaType } from "../sdk/stored-source";
import type { HeaderValue } from "../sdk/types";

// ---------------------------------------------------------------------------
// Config → state translation
// ---------------------------------------------------------------------------

function headerValueToState(name: string, value: HeaderValue): CustomHeaderState {
  if (typeof value === "string") {
    // Plain string value (not a secret ref) — treat as custom with no secret
    return {
      name,
      secretId: null,
      presetKey: matchPresetKey(name, undefined),
    };
  }
  return {
    name,
    secretId: value.secretId,
    prefix: value.prefix,
    presetKey: matchPresetKey(name, value.prefix),
  };
}

function headersFromState(
  entries: readonly CustomHeaderState[],
): Record<string, HeaderValue> {
  const result: Record<string, HeaderValue> = {};
  for (const ch of entries) {
    const name = ch.name.trim();
    if (!name || !ch.secretId) continue;
    result[name] = {
      secretId: ch.secretId,
      ...(ch.prefix ? { prefix: ch.prefix } : {}),
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Edit form — rendered once the source has loaded.
// Initializes form state from props, so no useEffect mirror is needed.
// ---------------------------------------------------------------------------

function EditForm(props: {
  sourceId: string;
  initial: StoredSourceSchemaType;
  secretList: readonly SecretPickerSecret[];
  onSave: () => void;
}) {
  const scopeId = useScope();
  const doUpdate = useAtomSet(updateOpenApiSource, { mode: "promise" });
  const refreshSource = useAtomRefresh(openApiSourceAtom(scopeId, props.sourceId));

  const [baseUrl, setBaseUrl] = useState(props.initial.config.baseUrl ?? "");
  const [customHeaders, setCustomHeaders] = useState<CustomHeaderState[]>(() =>
    Object.entries(props.initial.config.headers ?? {}).map(([name, value]) =>
      headerValueToState(name, value),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const updateHeader = (index: number, update: Partial<CustomHeaderState>) => {
    setCustomHeaders((prev) =>
      prev.map((ch, i) => (i === index ? { ...ch, ...update } : ch)),
    );
    setDirty(true);
  };

  const removeHeader = (index: number) => {
    setCustomHeaders((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const addHeader = () => {
    setCustomHeaders((prev) => [
      ...prev,
      { name: "", secretId: null, presetKey: undefined },
    ]);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await doUpdate({
        path: { scopeId, namespace: props.sourceId },
        payload: {
          baseUrl: baseUrl.trim() || undefined,
          headers: headersFromState(customHeaders),
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
        <h1 className="text-xl font-semibold text-foreground">Edit OpenAPI Source</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Update the base URL and authentication headers for this source.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-card-foreground">{props.sourceId}</p>
        </div>
        <Badge variant="secondary" className="text-[10px]">
          OpenAPI
        </Badge>
      </div>

      {/* Base URL */}
      <section className="space-y-2">
        <Label>Base URL</Label>
        <Input
          value={baseUrl}
          onChange={(e) => {
            setBaseUrl((e.target as HTMLInputElement).value);
            setDirty(true);
          }}
          placeholder="https://api.example.com"
          className="font-mono text-sm"
        />
      </section>

      {/* Headers */}
      <section className="space-y-2.5">
        <Label>Headers</Label>
        {customHeaders.map((ch, i) => (
          <CustomHeaderRow
            key={i}
            name={ch.name}
            prefix={ch.prefix}
            presetKey={ch.presetKey}
            secretId={ch.secretId}
            onChange={(update) => updateHeader(i, update)}
            onSelectSecret={(secretId) => updateHeader(i, { secretId })}
            onRemove={() => removeHeader(i)}
            existingSecrets={props.secretList}
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
// Main component — loads the source, then delegates to EditForm
// ---------------------------------------------------------------------------

export default function EditOpenApiSource(props: {
  sourceId: string;
  onSave: () => void;
}) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(openApiSourceAtom(scopeId, props.sourceId));
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
          <h1 className="text-xl font-semibold text-foreground">Edit OpenAPI Source</h1>
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
