import { useState } from "react";
import { useAtomSet, useAtomValue, Result } from "@effect-atom/atom-react";
import { useScope } from "@executor/react/api/scope-context";
import { sourceWriteKeys } from "@executor/react/api/reactivity-keys";
import { Badge } from "@executor/react/components/badge";
import { Button } from "@executor/react/components/button";
import {
  ApprovalPolicyToggles,
  HTTP_METHOD_TOKENS,
} from "@executor/react/plugins/approval-policy-field";
import type { GoogleDiscoveryStoredSourceSchemaType } from "../sdk/stored-source";

import { googleDiscoverySourceAtom, updateGoogleDiscoverySource } from "./atoms";

function EditForm(props: {
  sourceId: string;
  initial: GoogleDiscoveryStoredSourceSchemaType;
  onSave: () => void;
}) {
  const scopeId = useScope();
  const doUpdate = useAtomSet(updateGoogleDiscoverySource, { mode: "promise" });

  const config = props.initial.config;
  const authKind = config.auth.kind;

  const [annotationPolicy, setAnnotationPolicy] = useState<readonly string[] | undefined>(
    props.initial.annotationPolicy?.requireApprovalFor
      ? [...props.initial.annotationPolicy.requireApprovalFor]
      : undefined,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await doUpdate({
        path: { scopeId, namespace: props.sourceId },
        payload: {
          annotationPolicy:
            annotationPolicy === undefined
              ? null
              : {
                  requireApprovalFor: annotationPolicy as readonly (
                    | "get"
                    | "put"
                    | "post"
                    | "delete"
                    | "patch"
                    | "head"
                    | "options"
                  )[],
                },
        },
        reactivityKeys: sourceWriteKeys,
      });
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
        <h1 className="text-xl font-semibold text-foreground">Edit Google Discovery Source</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Adjust the approval policy for this Google API source. To change authentication, remove
          and re-add the source with updated OAuth credentials.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-card-foreground">
            {props.initial.name}
          </p>
          {config.discoveryUrl && (
            <p className="mt-0.5 text-xs text-muted-foreground font-mono truncate">
              {config.discoveryUrl}
            </p>
          )}
        </div>
        <Badge variant="secondary" className="text-xs">
          Google Discovery
        </Badge>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-border bg-card/50 p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Service
            </p>
            <p className="text-sm font-medium text-foreground">{config.service}</p>
          </div>
          <div className="rounded-lg border border-border bg-card/50 p-3">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
              Version
            </p>
            <p className="text-sm font-medium text-foreground">{config.version}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/50 p-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Authentication
          </p>
          <p className="text-sm font-medium text-foreground capitalize">
            {authKind === "oauth2" ? "OAuth 2.0" : authKind}
          </p>
        </div>
      </div>

      <ApprovalPolicyToggles
        tokens={HTTP_METHOD_TOKENS}
        value={annotationPolicy}
        onChange={(next) => {
          setAnnotationPolicy(next);
          setDirty(true);
        }}
        description="Choose which HTTP methods require approval before a tool call from this source runs. Defaults: write methods (POST / PUT / PATCH / DELETE) require approval."
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">{error}</p>
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

export default function EditGoogleDiscoverySource({
  sourceId,
  onSave,
}: {
  readonly sourceId: string;
  readonly onSave: () => void;
}) {
  const scopeId = useScope();
  const sourceResult = useAtomValue(googleDiscoverySourceAtom(scopeId, sourceId));

  if (!Result.isSuccess(sourceResult) || !sourceResult.value) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Edit Google Discovery Source</h1>
          <p className="mt-1 text-sm text-muted-foreground">Loading configuration…</p>
        </div>
      </div>
    );
  }

  return <EditForm sourceId={sourceId} initial={sourceResult.value} onSave={onSave} />;
}
