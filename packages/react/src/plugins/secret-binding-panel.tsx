import { useState } from "react";
import { useAtomSet } from "@effect-atom/atom-react";

import { SecretId } from "@executor/sdk";

import { setSecret } from "../api/atoms";
import { secretWriteKeys } from "../api/reactivity-keys";
import { useUserScope } from "../api/scope-context";
import { Button } from "../components/button";
import {
  CardStack,
  CardStackContent,
  CardStackEntryField,
  CardStackHeader,
} from "../components/card-stack";
import { FieldError } from "../components/field";
import { Input } from "../components/input";

export interface SecretBindingSpec {
  readonly secretId: string;
  readonly label: string;
  readonly description?: string;
  readonly placeholder?: string;
  readonly name?: string;
}

function SecretBindingField(props: {
  readonly sourceName?: string;
  readonly spec: SecretBindingSpec;
}) {
  const { sourceName, spec } = props;
  const userScope = useUserScope();
  const doSet = useAtomSet(setSecret, { mode: "promise" });

  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!spec.secretId.trim() || !value.trim()) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await doSet({
        path: { scopeId: userScope },
        payload: {
          id: SecretId.make(spec.secretId),
          name:
            spec.name ??
            ([sourceName?.trim(), spec.label].filter(Boolean).join(" ") || spec.label),
          value: value.trim(),
        },
        reactivityKeys: secretWriteKeys,
      });
      setValue("");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save secret");
    } finally {
      setSaving(false);
    }
  };

  return (
    <CardStackEntryField label={spec.label} hint={spec.description}>
      <div className="space-y-2">
        <div className="rounded-md bg-muted/30 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
          {spec.secretId}
        </div>
        <div className="flex gap-2">
          <Input
            type="password"
            value={value}
            onChange={(event) => {
              setValue((event.target as HTMLInputElement).value);
              if (saved) setSaved(false);
            }}
            placeholder={spec.placeholder ?? "Paste your value…"}
            className="font-mono text-sm"
          />
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!value.trim() || saving}
          >
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </Button>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </CardStackEntryField>
  );
}

export function SecretBindingPanel(props: {
  readonly title?: string;
  readonly description?: string;
  readonly sourceName?: string;
  readonly specs: readonly SecretBindingSpec[];
}) {
  if (props.specs.length === 0) return null;

  return (
    <CardStack>
      <CardStackHeader>
        <div className="space-y-1">
          <div>{props.title ?? "Your Credentials"}</div>
          <div className="text-xs font-normal text-muted-foreground">
            {props.description ??
              "Values saved here land in your personal scope and shadow any shared default."}
          </div>
        </div>
      </CardStackHeader>
      <CardStackContent>
        {props.specs.map((spec) => (
          <SecretBindingField
            key={spec.secretId}
            sourceName={props.sourceName}
            spec={spec}
          />
        ))}
      </CardStackContent>
    </CardStack>
  );
}
