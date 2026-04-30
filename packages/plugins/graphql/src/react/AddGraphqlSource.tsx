import { useState } from "react";
import { useAtomSet } from "@effect-atom/atom-react";

import { useScope } from "@executor/react/api/scope-context";
import { sourceWriteKeys } from "@executor/react/api/reactivity-keys";
import { usePendingSources } from "@executor/react/api/optimistic";
import {
  HttpCredentialsEditor,
  httpCredentialsValid,
  serializeHttpCredentials,
  type HttpCredentialsState,
} from "@executor/react/plugins/http-credentials";
import {
  displayNameFromUrl,
  slugifyNamespace,
  SourceIdentityFields,
  useSourceIdentity,
} from "@executor/react/plugins/source-identity";
import { useSecretPickerSecrets } from "@executor/react/plugins/use-secret-picker-secrets";
import { Button } from "@executor/react/components/button";
import {
  CardStack,
  CardStackContent,
  CardStackEntryField,
} from "@executor/react/components/card-stack";
import { FloatActions } from "@executor/react/components/float-actions";
import { Input } from "@executor/react/components/input";
import { Spinner } from "@executor/react/components/spinner";
import { addGraphqlSource } from "./atoms";
import type { HeaderValue } from "../sdk/types";

export default function AddGraphqlSource(props: {
  onComplete: () => void;
  onCancel: () => void;
  initialUrl?: string;
}) {
  const [endpoint, setEndpoint] = useState(props.initialUrl ?? "");
  const identity = useSourceIdentity({
    fallbackName: displayNameFromUrl(endpoint) ?? "",
  });
  const [credentials, setCredentials] = useState<HttpCredentialsState>({
    headers: [
      {
        name: "Authorization",
        prefix: "Bearer ",
        presetKey: "bearer",
        secretId: null,
      },
    ],
    queryParams: [],
  });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const scopeId = useScope();
  const doAdd = useAtomSet(addGraphqlSource, { mode: "promise" });
  const { beginAdd } = usePendingSources();
  const secretList = useSecretPickerSecrets();

  const canAdd = endpoint.trim().length > 0 && httpCredentialsValid(credentials);

  const handleAdd = async () => {
    setAdding(true);
    setAddError(null);
    const { headers: headerMap, queryParams } = serializeHttpCredentials(credentials);

    const trimmedEndpoint = endpoint.trim();
    const namespace =
      slugifyNamespace(identity.namespace) ||
      slugifyNamespace(displayNameFromUrl(trimmedEndpoint) ?? "") ||
      "graphql";
    const displayName = identity.name.trim() || displayNameFromUrl(trimmedEndpoint) || namespace;
    const placeholder = beginAdd({
      id: namespace,
      name: displayName,
      kind: "graphql",
      url: trimmedEndpoint || undefined,
    });
    try {
      await doAdd({
        path: { scopeId },
        payload: {
          endpoint: trimmedEndpoint,
          name: identity.name.trim() || undefined,
          namespace: slugifyNamespace(identity.namespace) || undefined,
          ...(Object.keys(headerMap).length > 0 ? { headers: headerMap } : {}),
          ...(Object.keys(queryParams).length > 0
            ? { queryParams: queryParams as Record<string, HeaderValue> }
            : {}),
        },
        reactivityKeys: sourceWriteKeys,
      });
      props.onComplete();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : "Failed to add source");
      setAdding(false);
    } finally {
      placeholder.done();
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Add GraphQL Source</h1>

      <CardStack>
        <CardStackContent className="border-t-0">
          <CardStackEntryField
            label="Endpoint"
            hint="The endpoint will be introspected to discover available queries and mutations."
          >
            <Input
              value={endpoint}
              onChange={(e) => setEndpoint((e.target as HTMLInputElement).value)}
              placeholder="https://api.example.com/graphql"
              className="font-mono text-sm"
            />
          </CardStackEntryField>
        </CardStackContent>
      </CardStack>

      <SourceIdentityFields identity={identity} namePlaceholder="e.g. Shopify API" />

      <HttpCredentialsEditor
        credentials={credentials}
        onChange={setCredentials}
        existingSecrets={secretList}
        sourceName={identity.name}
      />

      {/* Error */}
      {addError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{addError}</p>
        </div>
      )}

      <FloatActions>
        <Button variant="ghost" onClick={props.onCancel} disabled={adding}>
          Cancel
        </Button>
        <Button onClick={handleAdd} disabled={!canAdd || adding}>
          {adding && <Spinner className="size-3.5" />}
          {adding ? "Adding..." : "Add source"}
        </Button>
      </FloatActions>
    </div>
  );
}
