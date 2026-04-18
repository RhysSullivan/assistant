import { useState } from "react";
import { useAtomSet } from "@effect-atom/atom-react";
import { Link } from "@tanstack/react-router";

import { useScope } from "@executor/react/api/scope-context";
import { sourceWriteKeys } from "@executor/react/api/reactivity-keys";
import { usePendingSources } from "@executor/react/api/optimistic";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@executor/react/components/breadcrumb";
import { Button } from "@executor/react/components/button";
import { FloatActions } from "@executor/react/components/float-actions";
import { SourceHeader } from "@executor/react/components/source-header";
import { Spinner } from "@executor/react/components/spinner";
import { FilterTabs } from "@executor/react/components/filter-tabs";
import { SourceConfig } from "@executor/react/plugins/source-config";
import type { KeyValueEntry } from "@executor/react/plugins/key-value-list";
import {
  displayNameFromUrl,
  slugifyNamespace,
  SourceIdentityFields,
  useSourceIdentity,
} from "@executor/react/plugins/source-identity";
import { useSecretPickerSecrets } from "@executor/react/plugins/use-secret-picker-secrets";
import { addGraphqlSource } from "./atoms";
import { headersFromAuth } from "./headers";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AddGraphqlSource(props: {
  onComplete: () => void;
  onCancel: () => void;
  initialUrl?: string;
}) {
  const [endpoint, setEndpoint] = useState(props.initialUrl ?? "");
  const identity = useSourceIdentity({
    fallbackName: displayNameFromUrl(endpoint) ?? "",
  });

  // Auth state
  const [bearerSecretId, setBearerSecretId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<readonly KeyValueEntry[]>([]);

  const [activeTab, setActiveTab] = useState<"settings" | "operations">("settings");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopeId = useScope();
  const doAdd = useAtomSet(addGraphqlSource, { mode: "promise" });
  const { beginAdd } = usePendingSources();
  const secretList = useSecretPickerSecrets();

  const canAdd = endpoint.trim().length > 0;

  const handleAdd = async () => {
    setAdding(true);
    setError(null);
    const headerMap = headersFromAuth(bearerSecretId, headers);

    const trimmedEndpoint = endpoint.trim();
    const namespace =
      slugifyNamespace(identity.namespace) ||
      slugifyNamespace(displayNameFromUrl(trimmedEndpoint) ?? "") ||
      "graphql";
    const displayName =
      identity.name.trim() || displayNameFromUrl(trimmedEndpoint) || namespace;
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
        },
        reactivityKeys: sourceWriteKeys,
      });
      props.onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add source");
      setAdding(false);
    } finally {
      placeholder.done();
    }
  };

  const hasEndpoint = endpoint.trim().length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/">Sources</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Add GraphQL</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Source Header */}
      {hasEndpoint && (
        <SourceHeader
          url={endpoint}
          title={identity.name || displayNameFromUrl(endpoint) || "GraphQL API"}
        />
      )}

      <FilterTabs
        tabs={[
          { label: "Settings", value: "settings" },
          { label: "Operations", value: "operations" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "settings" && (
        <div className="space-y-6">
          <SourceIdentityFields
            identity={identity}
            namePlaceholder="e.g. Shopify API"
            endpoint={endpoint}
            onEndpointChange={setEndpoint}
            endpointLabel="URL"
            endpointPlaceholder="https://api.example.com/graphql"
          />

          <SourceConfig
            authMode="bearer"
            onAuthModeChange={() => {}}
            allowedAuthModes={["bearer"]}
            bearerSecretId={bearerSecretId}
            onBearerSecretChange={setBearerSecretId}
            headers={headers}
            onHeadersChange={setHeaders}
            secrets={secretList}
          />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-[12px] text-destructive">{error}</p>
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
