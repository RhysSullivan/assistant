import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  type CreateSourcePayload,
  type Source,
  type UpdateSourcePayload,
  useCreateSource,
  useRemoveSource,
  useSource,
  useUpdateSource,
} from "@executor-v3/react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { LoadableBlock } from "../components/loadable";
import {
  IconArrowLeft,
  IconPencil,
  IconPlus,
  IconTrash,
} from "../components/icons";
import { cn } from "../lib/utils";

type StatusBannerState = {
  tone: "info" | "success" | "error";
  text: string;
};

type SourceTemplate = {
  id: string;
  name: string;
  summary: string;
  kind: Source["kind"];
  endpoint: string;
  specUrl?: string;
  namespace?: string;
};

type TransportValue = "" | NonNullable<Source["transport"]>;

type SourceFormState = {
  name: string;
  kind: Source["kind"];
  endpoint: string;
  namespace: string;
  enabled: boolean;
  transport: TransportValue;
  queryParamsText: string;
  headersText: string;
  specUrl: string;
  defaultHeadersText: string;
  authKind: Source["auth"]["kind"];
  authHeaderName: string;
  authPrefix: string;
  bearerProviderId: string;
  bearerHandle: string;
  oauthAccessProviderId: string;
  oauthAccessHandle: string;
  oauthRefreshProviderId: string;
  oauthRefreshHandle: string;
};

const sourceTemplates: ReadonlyArray<SourceTemplate> = [
  {
    id: "deepwiki-mcp",
    name: "DeepWiki MCP",
    summary: "Repository docs and knowledge graphs via MCP.",
    kind: "mcp",
    endpoint: "https://mcp.deepwiki.com/mcp",
    namespace: "deepwiki",
  },
  {
    id: "github-rest",
    name: "GitHub REST API",
    summary: "Repos, issues, pull requests, actions, and org settings.",
    kind: "openapi",
    endpoint: "https://api.github.com",
    specUrl:
      "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml",
    namespace: "github",
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    summary: "Models, files, responses, and fine-tuning.",
    kind: "openapi",
    endpoint: "https://api.openai.com/v1",
    specUrl: "https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml",
    namespace: "openai",
  },
  {
    id: "vercel-api",
    name: "Vercel API",
    summary: "Deployments, projects, domains, and environments.",
    kind: "openapi",
    endpoint: "https://api.vercel.com",
    specUrl: "https://openapi.vercel.sh",
    namespace: "vercel",
  },
  {
    id: "stripe-api",
    name: "Stripe API",
    summary: "Payments, billing, subscriptions, and invoices.",
    kind: "openapi",
    endpoint: "https://api.stripe.com",
    specUrl: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    namespace: "stripe",
  },
  {
    id: "linear-graphql",
    name: "Linear GraphQL",
    summary: "Issues, teams, cycles, and projects.",
    kind: "graphql",
    endpoint: "https://api.linear.app/graphql",
    namespace: "linear",
  },
];

const kindOptions: ReadonlyArray<Source["kind"]> = ["mcp", "openapi", "graphql", "internal"];

const transportOptions: ReadonlyArray<NonNullable<Source["transport"]>> = [
  "auto",
  "streamable-http",
  "sse",
];

const authOptions: ReadonlyArray<Source["auth"]["kind"]> = ["none", "bearer", "oauth2"];

const trimToNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const stringMapToEditor = (value: Source["queryParams"] | Source["headers"] | Source["defaultHeaders"]): string =>
  value === null ? "" : JSON.stringify(value, null, 2);

const defaultFormState = (template?: SourceTemplate): SourceFormState => ({
  name: template?.name ?? "",
  kind: template?.kind ?? "openapi",
  endpoint: template?.endpoint ?? "",
  namespace: template?.namespace ?? "",
  enabled: true,
  transport: template?.kind === "mcp" ? "auto" : "",
  queryParamsText: "",
  headersText: "",
  specUrl: template?.specUrl ?? "",
  defaultHeadersText: "",
  authKind: "none",
  authHeaderName: "Authorization",
  authPrefix: "Bearer ",
  bearerProviderId: "",
  bearerHandle: "",
  oauthAccessProviderId: "",
  oauthAccessHandle: "",
  oauthRefreshProviderId: "",
  oauthRefreshHandle: "",
});

const formStateFromSource = (source: Source): SourceFormState => ({
  name: source.name,
  kind: source.kind,
  endpoint: source.endpoint,
  namespace: source.namespace ?? "",
  enabled: source.enabled,
  transport: source.kind === "mcp" ? (source.transport ?? "auto") : "",
  queryParamsText: stringMapToEditor(source.queryParams),
  headersText: stringMapToEditor(source.headers),
  specUrl: source.specUrl ?? "",
  defaultHeadersText: stringMapToEditor(source.defaultHeaders),
  authKind: source.auth.kind,
  authHeaderName: source.auth.kind === "none" ? "Authorization" : source.auth.headerName,
  authPrefix: source.auth.kind === "none" ? "Bearer " : source.auth.prefix,
  bearerProviderId: source.auth.kind === "bearer" ? source.auth.token.providerId : "",
  bearerHandle: source.auth.kind === "bearer" ? source.auth.token.handle : "",
  oauthAccessProviderId: source.auth.kind === "oauth2" ? source.auth.accessToken.providerId : "",
  oauthAccessHandle: source.auth.kind === "oauth2" ? source.auth.accessToken.handle : "",
  oauthRefreshProviderId:
    source.auth.kind === "oauth2" && source.auth.refreshToken !== null
      ? source.auth.refreshToken.providerId
      : "",
  oauthRefreshHandle:
    source.auth.kind === "oauth2" && source.auth.refreshToken !== null
      ? source.auth.refreshToken.handle
      : "",
});

const parseJsonStringMap = (label: string, text: string): Record<string, string> | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${label} must be valid JSON.`);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`${label} must be a JSON object with string values.`);
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      throw new Error(`${label} must only contain string values.`);
    }
    normalized[key] = value;
  }

  return Object.keys(normalized).length === 0 ? null : normalized;
};

const buildAuthPayload = (state: SourceFormState): CreateSourcePayload["auth"] => {
  if (state.authKind === "none") {
    return { kind: "none" };
  }

  const headerName = state.authHeaderName.trim() || "Authorization";
  const prefix = state.authPrefix;

  if (state.authKind === "bearer") {
    const providerId = state.bearerProviderId.trim();
    const handle = state.bearerHandle.trim();
    if (!providerId || !handle) {
      throw new Error("Bearer auth requires both a provider ID and a secret handle.");
    }

    return {
      kind: "bearer",
      headerName,
      prefix,
      token: {
        providerId,
        handle,
      },
    };
  }

  const accessProviderId = state.oauthAccessProviderId.trim();
  const accessHandle = state.oauthAccessHandle.trim();
  if (!accessProviderId || !accessHandle) {
    throw new Error("OAuth2 auth requires an access token provider ID and handle.");
  }

  const refreshProviderId = trimToNull(state.oauthRefreshProviderId);
  const refreshHandle = trimToNull(state.oauthRefreshHandle);
  if ((refreshProviderId === null) !== (refreshHandle === null)) {
    throw new Error("OAuth2 refresh token provider ID and handle must be set together.");
  }

  return {
    kind: "oauth2",
    headerName,
    prefix,
    accessToken: {
      providerId: accessProviderId,
      handle: accessHandle,
    },
    refreshToken:
      refreshProviderId === null || refreshHandle === null
        ? null
        : {
            providerId: refreshProviderId,
            handle: refreshHandle,
          },
  };
};

const buildSourcePayload = (state: SourceFormState): CreateSourcePayload => {
  const name = state.name.trim();
  const endpoint = state.endpoint.trim();

  if (!name) {
    throw new Error("Source name is required.");
  }

  if (!endpoint) {
    throw new Error("Source endpoint is required.");
  }

  const shared = {
    name,
    kind: state.kind,
    endpoint,
    enabled: state.enabled,
    namespace: trimToNull(state.namespace),
    auth: buildAuthPayload(state),
  } satisfies Pick<CreateSourcePayload, "name" | "kind" | "endpoint" | "enabled" | "namespace" | "auth">;

  if (state.kind === "mcp") {
    return {
      ...shared,
      transport: state.transport === "" ? "auto" : state.transport,
      queryParams: parseJsonStringMap("Query params", state.queryParamsText),
      headers: parseJsonStringMap("Request headers", state.headersText),
      specUrl: null,
      defaultHeaders: null,
    };
  }

  if (state.kind === "openapi") {
    const specUrl = state.specUrl.trim();
    if (!specUrl) {
      throw new Error("OpenAPI sources require a spec URL.");
    }

    return {
      ...shared,
      transport: null,
      queryParams: null,
      headers: null,
      specUrl,
      defaultHeaders: parseJsonStringMap("Default headers", state.defaultHeadersText),
    };
  }

  return {
    ...shared,
    transport: null,
    queryParams: null,
    headers: null,
    specUrl: null,
    defaultHeaders: null,
  };
};

const buildUpdatePayload = (state: SourceFormState): UpdateSourcePayload => ({
  ...buildSourcePayload(state),
});

export function NewSourcePage() {
  return <SourceEditor mode="create" />;
}

export function EditSourcePage(props: { sourceId: string }) {
  const source = useSource(props.sourceId);

  return (
    <LoadableBlock loadable={source} loading="Loading source...">
      {(loadedSource) => <SourceEditor mode="edit" source={loadedSource} />}
    </LoadableBlock>
  );
}

function SourceEditor(props: { mode: "create" | "edit"; source?: Source }) {
  const navigate = useNavigate();
  const createSource = useCreateSource();
  const updateSource = useUpdateSource();
  const removeSource = useRemoveSource();
  const [formState, setFormState] = useState<SourceFormState>(() =>
    props.source ? formStateFromSource(props.source) : defaultFormState(),
  );
  const [statusBanner, setStatusBanner] = useState<StatusBannerState | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (props.source) {
      setFormState(formStateFromSource(props.source));
      setStatusBanner(null);
    }
  }, [props.source]);

  const isSubmitting = createSource.status === "pending" || updateSource.status === "pending";
  const isDeleting = removeSource.status === "pending";

  const setField = <K extends keyof SourceFormState>(key: K, value: SourceFormState[K]) => {
    setFormState((current) => ({ ...current, [key]: value }));
  };

  const applyTemplate = (template: SourceTemplate) => {
    setSelectedTemplateId(template.id);
    setFormState((current) => ({
      ...defaultFormState(template),
      name: current.name.trim().length > 0 ? current.name : template.name,
      enabled: current.enabled,
      authKind: current.authKind,
      authHeaderName: current.authHeaderName,
      authPrefix: current.authPrefix,
      bearerProviderId: current.bearerProviderId,
      bearerHandle: current.bearerHandle,
      oauthAccessProviderId: current.oauthAccessProviderId,
      oauthAccessHandle: current.oauthAccessHandle,
      oauthRefreshProviderId: current.oauthRefreshProviderId,
      oauthRefreshHandle: current.oauthRefreshHandle,
    }));
    setStatusBanner({
      tone: "info",
      text: `${template.name} loaded. Add auth if needed, then save.`,
    });
  };

  const handleSubmit = async () => {
    setStatusBanner(null);

    try {
      if (props.mode === "create") {
        const createdSource = await createSource.mutateAsync(buildSourcePayload(formState));
        void navigate({
          to: "/sources/$sourceId",
          params: { sourceId: createdSource.id },
          search: { tab: "model" },
        });
        return;
      }

      if (!props.source) {
        throw new Error("Cannot update a source before it has loaded.");
      }

      const updatedSource = await updateSource.mutateAsync({
        sourceId: props.source.id,
        payload: buildUpdatePayload(formState),
      });
      void navigate({
        to: "/sources/$sourceId",
        params: { sourceId: updatedSource.id },
        search: { tab: "model" },
      });
    } catch (error) {
      setStatusBanner({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed saving source.",
      });
    }
  };

  const handleRemove = async () => {
    if (!props.source || isDeleting) {
      return;
    }

    const confirmed = window.confirm(`Remove "${props.source.name}" and its indexed tools?`);
    if (!confirmed) {
      return;
    }

    setStatusBanner(null);

    try {
      const result = await removeSource.mutateAsync(props.source.id);
      if (!result.removed) {
        throw new Error("Source was not removed.");
      }
      void navigate({ to: "/" });
    } catch (error) {
      setStatusBanner({
        tone: "error",
        text: error instanceof Error ? error.message : "Failed removing source.",
      });
    }
  };

  const backLink = props.mode === "edit" && props.source
    ? { to: "/sources/$sourceId" as const, params: { sourceId: props.source.id }, search: { tab: "model" as const } }
    : { to: "/" as const };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8 lg:px-10 lg:py-12">
        {/* Back + title */}
        <Link
          {...backLink}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground mb-6"
        >
          <IconArrowLeft className="size-3.5" />
          {props.mode === "edit" ? "Back to source" : "Back"}
        </Link>

        <div className="flex items-center justify-between gap-4 mb-6">
          <h1 className="font-display text-2xl tracking-tight text-foreground lg:text-3xl">
            {props.mode === "edit" ? "Edit source" : "New source"}
          </h1>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{formState.kind}</Badge>
            <Badge variant={formState.enabled ? "default" : "muted"}>
              {formState.enabled ? "enabled" : "disabled"}
            </Badge>
          </div>
        </div>

        {statusBanner && <StatusBanner state={statusBanner} className="mb-6" />}

        {/* Templates (create mode) */}
        {props.mode === "create" && (
          <Section title="Templates" className="mb-6">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sourceTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => applyTemplate(template)}
                  className={cn(
                    "rounded-xl border px-4 py-3 text-left transition-colors",
                    selectedTemplateId === template.id
                      ? "border-primary/40 bg-primary/8"
                      : "border-border bg-card/70 hover:bg-accent/50",
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[13px] font-medium text-foreground">{template.name}</span>
                    <Badge variant="outline" className="text-[9px]">{template.kind}</Badge>
                  </div>
                  <span className="text-[11px] text-muted-foreground line-clamp-1">
                    {template.summary}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {/* Form */}
        <div className="space-y-6">
          <Section title="Basics">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <TextInput
                  value={formState.name}
                  onChange={(value) => setField("name", value)}
                  placeholder="GitHub REST"
                />
              </Field>
              <Field label="Kind">
                <SelectInput
                  value={formState.kind}
                  onChange={(value) => setField("kind", value as Source["kind"])}
                  options={kindOptions.map((value) => ({ value, label: value }))}
                />
              </Field>
              <Field
                label="Endpoint"
                className="sm:col-span-2"
              >
                <TextInput
                  value={formState.endpoint}
                  onChange={(value) => setField("endpoint", value)}
                  placeholder={formState.kind === "openapi" ? "https://api.github.com" : "https://mcp.deepwiki.com/mcp"}
                  mono
                />
              </Field>
              <Field label="Namespace">
                <TextInput
                  value={formState.namespace}
                  onChange={(value) => setField("namespace", value)}
                  placeholder="github"
                />
              </Field>
              <Field label="Status">
                <ToggleButton
                  checked={formState.enabled}
                  onChange={(checked) => setField("enabled", checked)}
                />
              </Field>
            </div>
          </Section>

          {formState.kind === "mcp" && (
            <Section title="Transport">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Transport mode">
                  <SelectInput
                    value={formState.transport || "auto"}
                    onChange={(value) => setField("transport", value as TransportValue)}
                    options={transportOptions.map((value) => ({ value, label: value }))}
                  />
                </Field>
                <div className="sm:col-span-2 grid gap-4 sm:grid-cols-2">
                  <Field label="Query params (JSON)">
                    <CodeEditor
                      value={formState.queryParamsText}
                      onChange={(value) => setField("queryParamsText", value)}
                      placeholder={'{\n  "workspace": "demo"\n}'}
                    />
                  </Field>
                  <Field label="Headers (JSON)">
                    <CodeEditor
                      value={formState.headersText}
                      onChange={(value) => setField("headersText", value)}
                      placeholder={'{\n  "x-api-key": "..."\n}'}
                    />
                  </Field>
                </div>
              </div>
            </Section>
          )}

          {formState.kind === "openapi" && (
            <Section title="OpenAPI">
              <div className="grid gap-4">
                <Field label="Spec URL">
                  <TextInput
                    value={formState.specUrl}
                    onChange={(value) => setField("specUrl", value)}
                    placeholder="https://raw.githubusercontent.com/.../openapi.yaml"
                    mono
                  />
                </Field>
                <Field label="Default headers (JSON)">
                  <CodeEditor
                    value={formState.defaultHeadersText}
                    onChange={(value) => setField("defaultHeadersText", value)}
                    placeholder={'{\n  "x-api-version": "2026-03-01"\n}'}
                  />
                </Field>
              </div>
            </Section>
          )}

          <Section title="Authentication">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Auth mode">
                <SelectInput
                  value={formState.authKind}
                  onChange={(value) => setField("authKind", value as Source["auth"]["kind"])}
                  options={authOptions.map((value) => ({ value, label: value }))}
                />
              </Field>
              {formState.authKind !== "none" && (
                <>
                  <Field label="Header name">
                    <TextInput
                      value={formState.authHeaderName}
                      onChange={(value) => setField("authHeaderName", value)}
                      placeholder="Authorization"
                    />
                  </Field>
                  <Field label="Prefix">
                    <TextInput
                      value={formState.authPrefix}
                      onChange={(value) => setField("authPrefix", value)}
                      placeholder="Bearer "
                    />
                  </Field>
                </>
              )}

              {formState.authKind === "bearer" && (
                <>
                  <Field label="Provider ID">
                    <TextInput
                      value={formState.bearerProviderId}
                      onChange={(value) => setField("bearerProviderId", value)}
                      placeholder="keychain"
                      mono
                    />
                  </Field>
                  <Field label="Token handle">
                    <TextInput
                      value={formState.bearerHandle}
                      onChange={(value) => setField("bearerHandle", value)}
                      placeholder="oauth_access_token_123"
                      mono
                    />
                  </Field>
                </>
              )}

              {formState.authKind === "oauth2" && (
                <>
                  <Field label="Access token provider">
                    <TextInput
                      value={formState.oauthAccessProviderId}
                      onChange={(value) => setField("oauthAccessProviderId", value)}
                      placeholder="keychain"
                      mono
                    />
                  </Field>
                  <Field label="Access token handle">
                    <TextInput
                      value={formState.oauthAccessHandle}
                      onChange={(value) => setField("oauthAccessHandle", value)}
                      placeholder="oauth_access_token_123"
                      mono
                    />
                  </Field>
                  <Field label="Refresh token provider">
                    <TextInput
                      value={formState.oauthRefreshProviderId}
                      onChange={(value) => setField("oauthRefreshProviderId", value)}
                      placeholder="keychain"
                      mono
                    />
                  </Field>
                  <Field label="Refresh token handle">
                    <TextInput
                      value={formState.oauthRefreshHandle}
                      onChange={(value) => setField("oauthRefreshHandle", value)}
                      placeholder="oauth_refresh_token_123"
                      mono
                    />
                  </Field>
                </>
              )}
            </div>
          </Section>

          {/* Danger zone (edit mode) */}
          {props.mode === "edit" && props.source && (
            <Section title="Danger zone">
              <Button
                variant="outline"
                className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleRemove}
                disabled={isDeleting}
              >
                <IconTrash className="size-3.5" />
                {isDeleting ? "Removing\u2026" : "Remove source"}
              </Button>
            </Section>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
            <Link {...backLink} className="inline-flex">
              <Button variant="ghost" type="button">Cancel</Button>
            </Link>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {props.mode === "edit" ? <IconPencil className="size-3.5" /> : <IconPlus className="size-3.5" />}
              {isSubmitting
                ? props.mode === "edit"
                  ? "Saving\u2026"
                  : "Creating\u2026"
                : props.mode === "edit"
                  ? "Save"
                  : "Create source"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form building blocks
// ---------------------------------------------------------------------------

function Section(props: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-xl border border-border bg-card/80", props.className)}>
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-sm font-semibold text-foreground">{props.title}</h2>
      </div>
      <div className="p-5">{props.children}</div>
    </section>
  );
}

function Field(props: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block space-y-1.5", props.className)}>
      <span className="text-[12px] font-medium text-foreground">{props.label}</span>
      {props.children}
    </label>
  );
}

function TextInput(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      className={cn(
        "h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-ring focus:ring-1 focus:ring-ring/25",
        props.mono && "font-mono text-[12px]",
      )}
    />
  );
}

function SelectInput(props: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <select
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      className="h-9 w-full rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-1 focus:ring-ring/25"
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function CodeEditor(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
      placeholder={props.placeholder}
      spellCheck={false}
      className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/35 focus:border-ring focus:ring-1 focus:ring-ring/25"
    />
  );
}

function ToggleButton(props: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => props.onChange(!props.checked)}
      className={cn(
        "flex h-9 w-full items-center justify-between rounded-lg border px-3 text-[13px] transition-colors",
        props.checked
          ? "border-primary/40 bg-primary/8 text-foreground"
          : "border-input bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{props.checked ? "Enabled" : "Disabled"}</span>
      <span
        className={cn(
          "size-2 rounded-full",
          props.checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      />
    </button>
  );
}

function StatusBanner(props: { state: StatusBannerState; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-[13px]",
        props.state.tone === "success" && "border-primary/30 bg-primary/8 text-foreground",
        props.state.tone === "info" && "border-border bg-card text-muted-foreground",
        props.state.tone === "error" && "border-destructive/30 bg-destructive/8 text-destructive",
        props.className,
      )}
    >
      {props.state.text}
    </div>
  );
}
