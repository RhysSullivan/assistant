import { useId, useState } from "react";

import { type ScopeId } from "@executor-js/sdk";
import { Button } from "../components/button";
import { Field, FieldGroup, FieldLabel } from "../components/field";
import { Input } from "../components/input";
import { SecretForm } from "./secret-form";
import { SecretPicker, type SecretPickerSecret } from "./secret-picker";

export interface HeaderAuthPreset {
  readonly key: string;
  readonly label: string;
  readonly name: string;
  readonly prefix?: string;
}

export const defaultHeaderAuthPresets: readonly HeaderAuthPreset[] = [
  { key: "bearer", label: "Bearer Token", name: "Authorization", prefix: "Bearer " },
  { key: "basic", label: "Basic Auth", name: "Authorization", prefix: "Basic " },
  { key: "api-key", label: "API Key", name: "X-API-Key" },
  { key: "auth-token", label: "Auth Token", name: "X-Auth-Token" },
  { key: "access-token", label: "Access Token", name: "X-Access-Token" },
  { key: "cookie", label: "Cookie", name: "Cookie" },
  { key: "custom", label: "Custom", name: "" },
];

export function InlineCreateSecret(props: {
  suggestedName: string;
  existingSecretIds: readonly string[];
  onCreated: (secretId: string) => void;
  onCancel: () => void;
  fallbackId?: string;
  targetScope?: ScopeId;
  writeScope?: ScopeId;
}) {
  return (
    <SecretForm.Provider
      existingSecretIds={props.existingSecretIds}
      suggestedName={props.suggestedName}
      fallbackId={props.fallbackId ?? "custom-header"}
      scopeId={props.targetScope ?? props.writeScope}
      onCreated={props.onCreated}
    >
      <div className="bg-primary/[0.03] px-4 py-3 space-y-3">
        <p className="text-[11px] font-semibold text-primary tracking-wide uppercase">New secret</p>
        <FieldGroup className="gap-3">
          <div className="grid grid-cols-2 gap-3">
            <SecretForm.NameField label="Label" placeholder="API Token" />
            <SecretForm.IdField placeholder="my-api-token" />
          </div>
          <SecretForm.ValueField revealable placeholder="paste your token or key…" />
        </FieldGroup>
        <div className="flex justify-end gap-1.5 pt-0.5">
          <Button variant="outline" size="xs" onClick={props.onCancel}>
            Cancel
          </Button>
          <SecretForm.SubmitButton size="xs">Create and use</SecretForm.SubmitButton>
        </div>
      </div>
    </SecretForm.Provider>
  );
}

function HeaderValuePreview(props: { headerName: string; secretId: string; prefix?: string }) {
  const { headerName, prefix } = props;

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 font-mono text-xs">
      <span className="text-muted-foreground shrink-0">{headerName}:</span>
      <span className="text-foreground truncate">
        {prefix && <span className="text-muted-foreground">{prefix}</span>}
        {"•".repeat(12)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header state helpers — shared by edit forms
// ---------------------------------------------------------------------------

export type HeaderState = {
  name: string;
  secretId: string | null;
  prefix?: string;
  presetKey?: string;
  fromPreset?: boolean;
};

export function matchPresetKey(name: string, prefix?: string): string {
  const preset =
    defaultHeaderAuthPresets.find((p) => p.name === name && p.prefix === prefix) ??
    defaultHeaderAuthPresets.find((p) => p.name === name && p.prefix === undefined);
  return preset?.key ?? "custom";
}

export function headerValueToState(
  name: string,
  value: { secretId: string; prefix?: string } | string,
): HeaderState {
  if (typeof value === "string") {
    return { name, secretId: null, presetKey: matchPresetKey(name, undefined) };
  }
  return {
    name,
    secretId: value.secretId,
    prefix: value.prefix,
    presetKey: matchPresetKey(name, value.prefix),
  };
}

export function headersFromState(
  entries: readonly HeaderState[],
): Record<string, { secretId: string; prefix?: string }> {
  const result: Record<string, { secretId: string; prefix?: string }> = {};
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
// Secret header auth row
// ---------------------------------------------------------------------------

export function SecretHeaderAuthRow(props: {
  name: string;
  prefix?: string;
  presetKey?: string;
  secretId: string | null;
  onChange: (update: { name: string; prefix?: string; presetKey?: string }) => void;
  onSelectSecret: (secretId: string) => void;
  existingSecrets: readonly SecretPickerSecret[];
  onRemove?: () => void;
  removeLabel?: string;
  label?: string;
  /**
   * Display name of the source this header belongs to (e.g. "Axiom"). Used
   * to prefix the suggested secret label and ID so tokens from different
   * sources don't collide on ids like `authorization`.
   */
  sourceName?: string;
  targetScope?: ScopeId;
  writeScope?: ScopeId;
}) {
  const [creating, setCreating] = useState(false);
  const nameInputId = useId();
  const prefixInputId = useId();
  const {
    name,
    prefix,
    presetKey,
    secretId,
    onChange,
    onSelectSecret,
    existingSecrets,
    onRemove,
    removeLabel = "Remove",
    label = "Header",
    sourceName,
    targetScope,
    writeScope,
  } = props;

  const isCustom = presetKey === "custom" || presetKey === undefined;
  const headerLabel = name.trim() || "Custom Header";
  const suggestedName = [sourceName?.trim(), headerLabel].filter(Boolean).join(" ");

  if (creating) {
    return (
      <InlineCreateSecret
        suggestedName={suggestedName}
        existingSecretIds={existingSecrets.map((secret) => secret.id)}
        onCreated={(id) => {
          onSelectSecret(id);
          setCreating(false);
        }}
        onCancel={() => setCreating(false)}
        targetScope={targetScope ?? writeScope}
      />
    );
  }

  return (
    <div className="space-y-2.5 px-4 py-3">
      <div className="flex w-full items-center justify-between gap-4">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {onRemove && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            {removeLabel}
          </Button>
        )}
      </div>

      <FieldGroup className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor={nameInputId}>Name</FieldLabel>
          <Input
            id={nameInputId}
            value={name}
            onChange={(e) =>
              onChange({
                name: (e.target as HTMLInputElement).value,
                prefix,
                presetKey: isCustom ? "custom" : presetKey,
              })
            }
            placeholder="Authorization"
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={prefixInputId}>
            Prefix <span className="font-normal text-muted-foreground/60">(optional)</span>
          </FieldLabel>
          <Input
            id={prefixInputId}
            value={prefix ?? ""}
            onChange={(e) =>
              onChange({
                name,
                prefix: (e.target as HTMLInputElement).value || undefined,
                presetKey: isCustom ? "custom" : presetKey,
              })
            }
            placeholder="Bearer "
            className="font-mono"
          />
        </Field>
      </FieldGroup>

      <SecretPicker
        value={secretId}
        onSelect={onSelectSecret}
        secrets={existingSecrets}
        onCreateNew={() => setCreating(true)}
      />

      {secretId && name.trim() && (
        <HeaderValuePreview headerName={name.trim()} secretId={secretId} prefix={prefix} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreatableSecretPicker — SecretPicker + inline "+ New secret" create flow
// ---------------------------------------------------------------------------

export function CreatableSecretPicker(props: {
  readonly value: string | null;
  readonly onSelect: (secretId: string) => void;
  readonly secrets: readonly SecretPickerSecret[];
  readonly placeholder?: string;
  readonly targetScope?: ScopeId;
  readonly suggestedId?: string;
  /**
   * Display name of the source the secret belongs to (e.g. "Stripe").
   * Combined with `secretLabel` to produce a suggested name/ID.
   */
  readonly sourceName?: string;
  /** Role of this secret (e.g. "Client ID", "API Token"). */
  readonly secretLabel: string;
  readonly writeScope?: ScopeId;
}) {
  const {
    value,
    onSelect,
    secrets,
    placeholder,
    sourceName,
    secretLabel,
    targetScope,
    suggestedId: suggestedIdProp,
    writeScope,
  } = props;
  const [creating, setCreating] = useState(false);

  const suggestedName = [sourceName?.trim(), secretLabel].filter(Boolean).join(" ");

  if (creating) {
    return (
      <InlineCreateSecret
        suggestedName={suggestedName}
        existingSecretIds={secrets.map((secret) => secret.id)}
        fallbackId={suggestedIdProp?.trim() || "secret"}
        onCreated={(id) => {
          onSelect(id);
          setCreating(false);
        }}
        onCancel={() => setCreating(false)}
        targetScope={targetScope ?? writeScope}
      />
    );
  }

  return (
    <SecretPicker
      value={value}
      onSelect={onSelect}
      secrets={secrets}
      placeholder={placeholder}
      onCreateNew={() => setCreating(true)}
    />
  );
}
