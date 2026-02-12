"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Wrench,
  Plus,
  Trash2,
  Globe,
  Server,
  ChevronRight,
  AlertTriangle,
  KeyRound,
  Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { McpSetupCard } from "@/components/mcp-setup-card";
import { ToolExplorer } from "@/components/tool-explorer";
import { useSession } from "@/lib/session-context";
import { useWorkspaceTools } from "@/hooks/use-workspace-tools";
import { useAction, useMutation, useQuery } from "convex/react";
import { convexApi } from "@/lib/convex-api";
import type {
  ToolSourceRecord,
  CredentialRecord,
  CredentialScope,
  SourceAuthProfile,
  OpenApiSourceQuality,
} from "@/lib/types";
import { parse as parseDomain } from "tldts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Streamdown } from "streamdown";

interface CatalogCollectionItem {
  id: string;
  name: string;
  summary: string;
  specUrl: string;
  originUrl?: string;
  providerName: string;
  logoUrl?: string;
  categories?: string;
  version?: string;
  rank: number;
  addedAt: string;
}

const HARD_CODED_CATALOG_ITEMS: CatalogCollectionItem[] = [
  {
    id: "github-rest",
    name: "GitHub REST API",
    summary: "Manage repositories, pull requests, issues, and org settings.",
    specUrl: "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.yaml",
    originUrl: "https://docs.github.com/en/rest",
    providerName: "GitHub",
    categories: "developer-tools",
    version: "latest",
    rank: 1,
    addedAt: "2026-01-10",
  },
  {
    id: "stripe-api",
    name: "Stripe API",
    summary: "Create payments, manage customers, and handle billing workflows.",
    specUrl: "https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json",
    originUrl: "https://docs.stripe.com/api",
    providerName: "Stripe",
    categories: "payments",
    version: "2026-01",
    rank: 2,
    addedAt: "2026-01-08",
  },
  {
    id: "openai-api",
    name: "OpenAI API",
    summary: "Generate text, run reasoning models, and process multimodal inputs.",
    specUrl: "https://app.stainless.com/api/spec/documented/openai/openapi.documented.yml",
    originUrl: "https://platform.openai.com/docs/api-reference",
    providerName: "OpenAI",
    categories: "ai",
    version: "latest",
    rank: 3,
    addedAt: "2026-01-06",
  },
  {
    id: "cloudflare-api",
    name: "Cloudflare API",
    summary: "Control zones, DNS records, workers, and edge configuration.",
    specUrl: "https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.yaml",
    originUrl: "https://api.cloudflare.com/",
    providerName: "Cloudflare",
    categories: "infrastructure",
    version: "latest",
    rank: 4,
    addedAt: "2026-01-04",
  },
  {
    id: "vercel-api",
    name: "Vercel API",
    summary: "Manage deployments, projects, domains, and team resources.",
    specUrl: "https://openapi.vercel.sh",
    originUrl: "https://vercel.com/docs/rest-api",
    providerName: "Vercel",
    categories: "developer-tools",
    version: "latest",
    rank: 5,
    addedAt: "2025-12-18",
  },
  {
    id: "slack-api",
    name: "Slack API",
    summary: "Work with channels, messages, users, and workspace automation.",
    specUrl: "https://api.slack.com/specs/openapi/v2/slack_web.json",
    originUrl: "https://api.slack.com/web",
    providerName: "Slack",
    categories: "communications",
    version: "v2",
    rank: 6,
    addedAt: "2025-12-10",
  },
  {
    id: "sentry-api",
    name: "Sentry API",
    summary: "Query issues, releases, projects, and alerting configuration.",
    specUrl: "https://raw.githubusercontent.com/getsentry/sentry-api-schema/refs/heads/main/openapi-derefed.json",
    originUrl: "https://docs.sentry.io/api/",
    providerName: "Sentry",
    categories: "observability",
    version: "latest",
    rank: 7,
    addedAt: "2025-11-30",
  },
  {
    id: "jira-cloud-api",
    name: "Jira Cloud Platform",
    summary: "Manage projects, issues, workflows, and Jira metadata.",
    specUrl: "https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json",
    originUrl: "https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/",
    providerName: "Atlassian",
    categories: "project-management",
    version: "v3",
    rank: 8,
    addedAt: "2025-11-15",
  },
];

/** Derive a favicon URL from any URL string via Google's favicon service. */
function faviconForUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return null;
  }
}

function getSourceFavicon(source: ToolSourceRecord): string | null {
  if (source.type === "mcp") {
    return faviconForUrl((source.config.url as string) ?? null);
  }
  if (source.type === "graphql") {
    return faviconForUrl((source.config.endpoint as string) ?? null);
  }
  const spec = source.config.spec as string | undefined;
  if (typeof spec === "string" && spec.startsWith("postman:")) {
    return null;
  }
  const baseUrl = source.config.baseUrl as string | undefined;
  const collectionUrl = source.config.collectionUrl as string | undefined;
  const specUrl = typeof spec === "string" && spec.startsWith("http") ? spec : null;
  return faviconForUrl(baseUrl ?? collectionUrl ?? specUrl);
}

function sourceEndpointLabel(source: ToolSourceRecord): string {
  if (source.type === "mcp") return (source.config.url as string) ?? "";
  if (source.type === "graphql") return (source.config.endpoint as string) ?? "";

  const spec = source.config.spec;
  if (typeof spec === "string" && spec.startsWith("postman:")) {
    const uid = spec.slice("postman:".length).trim();
    if (uid.length > 0) {
      return `catalog:${uid}`;
    }
    return "catalog:collection";
  }

  return (source.config.spec as string) ?? "";
}

function sourceKeyForSource(source: ToolSourceRecord): string | null {
  if (source.type === "openapi") return `source:${source.id}`;
  if (source.type === "graphql") return `source:${source.id}`;
  return null;
}

function toolSourceLabelForSource(source: ToolSourceRecord): string {
  return `${source.type}:${source.name}`;
}

function sourceForCredentialKey(sources: ToolSourceRecord[], sourceKey: string): ToolSourceRecord | null {
  const prefix = "source:";
  if (!sourceKey.startsWith(prefix)) return null;
  const sourceId = sourceKey.slice(prefix.length);
  if (!sourceId) return null;
  return sources.find((source) => source.id === sourceId) ?? null;
}

type SourceAuthType = "none" | "bearer" | "apiKey" | "basic" | "mixed";
type SourceAuthMode = "workspace" | "actor";

function normalizeSourceAuthProfile(profile: SourceAuthProfile | undefined): {
  type: SourceAuthType;
  mode?: SourceAuthMode;
  header?: string;
  inferred?: boolean;
} {
  if (!profile) {
    return { type: "none" };
  }

  const type = profile.type === "mixed"
    ? "mixed"
    : profile.type === "basic"
      ? "basic"
      : profile.type === "apiKey"
        ? "apiKey"
        : profile.type === "bearer"
          ? "bearer"
          : "none";

  const mode = profile.mode === "actor" ? "actor" : profile.mode === "workspace" ? "workspace" : undefined;
  const header = typeof profile.header === "string" && profile.header.trim().length > 0
    ? profile.header.trim()
    : undefined;

  return {
    type,
    ...(mode ? { mode } : {}),
    ...(header ? { header } : {}),
    inferred: Boolean(profile.inferred),
  };
}

function readSourceAuth(
  source: ToolSourceRecord,
  inferredProfile?: SourceAuthProfile,
): {
  type: SourceAuthType;
  mode?: SourceAuthMode;
  header?: string;
  inferred?: boolean;
} {
  if (source.type !== "openapi" && source.type !== "graphql") {
    return { type: "none" };
  }

  const inferred = normalizeSourceAuthProfile(inferredProfile);

  const auth = source.config.auth as Record<string, unknown> | undefined;
  const type =
    auth && typeof auth.type === "string" && ["none", "bearer", "apiKey", "basic", "mixed"].includes(auth.type)
      ? (auth.type as SourceAuthType)
      : inferred.type;

  const mode =
    auth && typeof auth.mode === "string" && (auth.mode === "workspace" || auth.mode === "actor")
      ? (auth.mode as SourceAuthMode)
      : inferred.mode;

  const header = auth && typeof auth.header === "string" && auth.header.trim().length > 0
    ? auth.header.trim()
    : inferred.header;

  return {
    type,
    ...(mode ? { mode } : {}),
    ...(header ? { header } : {}),
    inferred: auth?.type === undefined ? inferred.inferred : false,
  };
}

function formatSourceAuthBadge(source: ToolSourceRecord, inferredProfile?: SourceAuthProfile): string | null {
  const auth = readSourceAuth(source, inferredProfile);
  if (auth.type === "none") return null;
  if (auth.type === "mixed") return "Mixed auth";
  const mode = auth.mode ?? "workspace";
  const authLabel =
    auth.type === "apiKey"
      ? "API Key"
      : auth.type === "bearer"
        ? "Bearer"
        : auth.type === "basic"
          ? "Basic"
          : "Auth";
  return `${authLabel} · ${mode === "actor" ? "user" : "workspace"}`;
}

function credentialStatsForSource(source: ToolSourceRecord, credentials: CredentialRecord[]): {
  workspaceCount: number;
  actorCount: number;
} {
  const sourceKey = sourceKeyForSource(source);
  if (!sourceKey) {
    return { workspaceCount: 0, actorCount: 0 };
  }

  let workspaceCount = 0;
  let actorCount = 0;
  for (const credential of credentials) {
    if (credential.sourceKey !== sourceKey) continue;
    if (credential.scope === "workspace") workspaceCount += 1;
    if (credential.scope === "actor") actorCount += 1;
  }

  return { workspaceCount, actorCount };
}

function formatQualityPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function qualityToneClass(quality: OpenApiSourceQuality): string {
  if (quality.overallQuality >= 0.95) {
    return "text-terminal-green";
  }
  if (quality.overallQuality >= 0.85) {
    return "text-terminal-amber";
  }
  return "text-terminal-red";
}

function qualitySummaryLabel(quality: OpenApiSourceQuality): string {
  if (quality.overallQuality >= 0.95) {
    return "strong typing";
  }
  if (quality.overallQuality >= 0.85) {
    return "mostly typed";
  }
  return "needs type cleanup";
}

function displaySourceName(name: string): string {
  const parts = name.split(/[-_.]+/).filter(Boolean);
  if (parts.length === 0) return name;

  const deduped = parts.filter((part, index, all) => {
    if (index === 0) return true;
    return part.toLowerCase() !== all[index - 1]?.toLowerCase();
  });

  const tokenMap: Record<string, string> = {
    api: "API",
    oauth: "OAuth",
    graphql: "GraphQL",
    mcp: "MCP",
    github: "GitHub",
  };

  return deduped
    .map((token) => {
      const lower = token.toLowerCase();
      if (tokenMap[lower]) return tokenMap[lower];
      return `${lower[0]?.toUpperCase() ?? ""}${lower.slice(1)}`;
    })
    .join(" ");
}

function compactEndpointLabel(source: ToolSourceRecord): string {
  const endpoint = sourceEndpointLabel(source);
  if (endpoint.startsWith("catalog:")) return endpoint;
  try {
    const parsed = new URL(endpoint);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return endpoint;
  }
}

// ── Add Source Dialog ──

const RAW_HOSTS = new Set([
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "raw.github.com",
]);

function inferNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parsed = parseDomain(url);

    if (RAW_HOSTS.has(u.hostname)) {
      const segments = u.pathname.split("/").filter(Boolean);
      if (segments.length > 0) return segments[0].toLowerCase();
    }

    if (parsed.domainWithoutSuffix) {
      return parsed.domainWithoutSuffix;
    }

    if (parsed.domain) {
      return parsed.domain.split(".")[0];
    }

    return u.hostname.replace(/\./g, "-");
  } catch {
    return "";
  }
}

function sanitizeSourceName(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "source";
}

function withUniqueSourceName(baseName: string, takenNames: Set<string>): string {
  const loweredTaken = new Set([...takenNames].map((name) => name.toLowerCase()));
  const candidate = sanitizeSourceName(baseName);
  if (!loweredTaken.has(candidate.toLowerCase())) {
    return candidate;
  }

  let suffix = 2;
  while (true) {
    const next = `${candidate}-${suffix}`;
    if (!loweredTaken.has(next.toLowerCase())) {
      return next;
    }
    suffix += 1;
  }
}

function catalogSourceName(item: CatalogCollectionItem): string {
  const owner = sanitizeSourceName(item.providerName || "catalog");
  const title = sanitizeSourceName(item.name);
  return sanitizeSourceName(`${owner}-${title}`);
}

function AddSourceDialog({
  existingSourceNames,
  onSourceAdded,
}: {
  existingSourceNames: Set<string>;
  onSourceAdded?: (source: ToolSourceRecord) => void;
}) {
  const { context } = useSession();
  const upsertToolSource = useMutation(convexApi.workspace.upsertToolSource);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"catalog" | "custom">("catalog");
  const [type, setType] = useState<"mcp" | "openapi" | "graphql">("mcp");
  const [name, setName] = useState("");
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [mcpTransport, setMcpTransport] = useState<"auto" | "streamable-http" | "sse">("auto");
  const [mcpActorQueryParamKey, setMcpActorQueryParamKey] = useState("userId");
  const [submitting, setSubmitting] = useState(false);
  const [locallyReservedNames, setLocallyReservedNames] = useState<string[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogSort, setCatalogSort] = useState<"popular" | "recent">("popular");
  const [addingCatalogId, setAddingCatalogId] = useState<string | null>(null);

  const visibleCatalogItems = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    const filtered = HARD_CODED_CATALOG_ITEMS.filter((item) => {
      if (!query) return true;
      return [
        item.name,
        item.providerName,
        item.summary,
        item.categories ?? "",
      ].some((value) => value.toLowerCase().includes(query));
    });

    return [...filtered].sort((a, b) => {
      if (catalogSort === "recent") {
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      }
      return a.rank - b.rank;
    });
  }, [catalogQuery, catalogSort]);

  const getTakenSourceNames = () => new Set([...existingSourceNames, ...locallyReservedNames]);

  const reserveSourceName = (sourceName: string) => {
    setLocallyReservedNames((current) =>
      current.includes(sourceName)
        ? current
        : [...current, sourceName]
    );
  };

  const getUniqueAutoSourceName = (candidate: string) => {
    return withUniqueSourceName(candidate, getTakenSourceNames());
  };

  const handleEndpointChange = (value: string) => {
    setEndpoint(value);
    if (!nameManuallyEdited) {
      const inferred = inferNameFromUrl(value);
      if (inferred) setName(inferred);
    }
  };

  const handleNameChange = (value: string) => {
    setName(value);
    setNameManuallyEdited(true);
  };

  const resetDialogState = () => {
    setView("catalog");
    setType("mcp");
    setName("");
    setEndpoint("");
    setBaseUrl("");
    setMcpTransport("auto");
    setMcpActorQueryParamKey("userId");
    setNameManuallyEdited(false);
    setLocallyReservedNames([]);
    setCatalogQuery("");
    setCatalogSort("popular");
    setAddingCatalogId(null);
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      resetDialogState();
    }
  };

  const addSource = async (
    sourceName: string,
    sourceType: "mcp" | "openapi" | "graphql",
    config: Record<string, unknown>,
  ) => {
    if (!context) return;
    const created = await upsertToolSource({
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      name: sourceName,
      type: sourceType,
      config,
    });
    onSourceAdded?.(created as ToolSourceRecord);
    toast.success(`Source "${sourceName}" added — loading tools…`);
  };

  const handleCatalogAdd = async (item: CatalogCollectionItem) => {
    if (!item.specUrl.trim()) {
      toast.error("Missing OpenAPI spec URL for this API source");
      return;
    }

    setAddingCatalogId(item.id);
    try {
      const sourceName = getUniqueAutoSourceName(catalogSourceName(item));
      await addSource(sourceName, "openapi", {
        spec: item.specUrl,
      });
      reserveSourceName(sourceName);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add API source");
    } finally {
      setAddingCatalogId(null);
    }
  };

  const handleCustomSubmit = async () => {
    if (!context || !name.trim() || !endpoint.trim()) return;

    const takenNames = [...getTakenSourceNames()].map((entry) => entry.toLowerCase());
    if (takenNames.includes(name.trim().toLowerCase())) {
      toast.error(`Source name "${name.trim()}" already exists`);
      return;
    }

    setSubmitting(true);
    try {
      const config: Record<string, unknown> =
        type === "mcp"
          ? {
              url: endpoint,
              ...(mcpTransport !== "auto" ? { transport: mcpTransport } : {}),
              ...(mcpActorQueryParamKey.trim() && context.actorId
                ? { queryParams: { [mcpActorQueryParamKey.trim()]: context.actorId } }
                : {}),
            }
          : type === "graphql"
            ? { endpoint: endpoint }
            : { spec: endpoint, ...(baseUrl ? { baseUrl } : {}) };
      await addSource(name.trim(), type, config);
      reserveSourceName(name.trim());
      resetDialogState();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Source
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-0">
          <DialogTitle className="text-sm font-medium">
            Add Tool Source
          </DialogTitle>
        </DialogHeader>

        <div className="p-5 space-y-4">
          {view === "catalog" ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                  placeholder="Search APIs"
                  className="h-8 text-xs font-mono bg-background flex-1 min-w-[150px]"
                />
                <Select
                  value={catalogSort}
                  onValueChange={(value) => setCatalogSort(value as "popular" | "recent")}
                >
                  <SelectTrigger className="h-8 w-[105px] text-xs bg-background shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="popular" className="text-xs">Popular</SelectItem>
                    <SelectItem value="recent" className="text-xs">Recent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="text-[11px] text-muted-foreground">
                Browse curated APIs and add them as tool sources. Showing {visibleCatalogItems.length}.
              </p>

              <Separator />

              <div className="max-h-80 overflow-y-auto overflow-x-hidden space-y-1 pr-1">
                <button
                  type="button"
                  onClick={() => setView("custom")}
                  className="w-full max-w-full overflow-hidden text-left px-3 py-2 rounded-md border border-border/70 bg-muted/40 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-muted">
                      <Plus className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0 w-0 flex-1 overflow-hidden">
                      <p className="text-xs font-medium">Add custom source</p>
                      <p className="text-[10px] text-muted-foreground">MCP, OpenAPI, or GraphQL endpoint</p>
                    </div>
                  </div>
                </button>

                {visibleCatalogItems.map((item) => (
                  <div
                    key={item.id}
                    className="w-full max-w-full overflow-hidden flex items-start gap-2 px-2 py-2 rounded-md border border-border/50"
                  >
                    {item.logoUrl && (
                      <img
                        src={item.logoUrl}
                        alt=""
                        className="w-5 h-5 rounded shrink-0 mt-0.5 object-contain"
                        loading="lazy"
                      />
                    )}
                    <div className="flex-1 min-w-0 w-0 overflow-hidden">
                      <p className="text-xs font-medium truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {item.providerName}
                        {item.version ? ` · v${item.version}` : ""}
                      </p>
                      {item.summary && (
                        <div
                          className="mt-0.5 w-full min-w-0 max-w-full overflow-hidden text-[10px] text-muted-foreground/90 leading-relaxed break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_*]:min-w-0 [&_*]:break-words [&_a]:break-all [&_a]:whitespace-normal [&_code]:break-all [&_code]:whitespace-pre-wrap [&_p]:m-0 [&_pre]:max-w-full [&_pre]:overflow-x-hidden [&_pre]:whitespace-pre-wrap [&_pre]:break-words line-clamp-2"
                          style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                        >
                          <Streamdown controls={false}>{item.summary}</Streamdown>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => void handleCatalogAdd(item)}
                        disabled={Boolean(addingCatalogId)}
                      >
                        {addingCatalogId === item.id ? "Adding..." : "Add"}
                      </Button>
                    </div>
                  </div>
                ))}

                {visibleCatalogItems.length === 0 && (
                  <p className="text-[11px] text-muted-foreground px-1 py-1">
                    No collections found for this query.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setView("catalog")}
              >
                <ChevronRight className="h-3.5 w-3.5 mr-1 rotate-180" />
                Back to API list
              </Button>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select
                  value={type}
                  onValueChange={(value) => setType(value as "mcp" | "openapi" | "graphql")}
                >
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mcp" className="text-xs">MCP Server</SelectItem>
                    <SelectItem value="openapi" className="text-xs">OpenAPI Spec</SelectItem>
                    <SelectItem value="graphql" className="text-xs">GraphQL</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  {type === "mcp" ? "Endpoint URL" : type === "graphql" ? "GraphQL Endpoint" : "Spec URL"}
                </Label>
                <Input
                  value={endpoint}
                  onChange={(event) => handleEndpointChange(event.target.value)}
                  placeholder={
                    type === "mcp"
                      ? "https://mcp-server.example.com/sse"
                      : type === "graphql"
                        ? "https://api.example.com/graphql"
                        : "https://api.example.com/openapi.json"
                  }
                  className="h-8 text-xs font-mono bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Name</Label>
                <Input
                  value={name}
                  onChange={(event) => handleNameChange(event.target.value)}
                  placeholder="e.g. my-service"
                  className="h-8 text-xs font-mono bg-background"
                />
              </div>

              {type === "openapi" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Base URL (optional)</Label>
                  <Input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://api.example.com"
                    className="h-8 text-xs font-mono bg-background"
                  />
                </div>
              )}

              {type === "mcp" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Transport</Label>
                    <Select
                      value={mcpTransport}
                      onValueChange={(value) => setMcpTransport(value as "auto" | "streamable-http" | "sse")}
                    >
                      <SelectTrigger className="h-8 text-xs bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto" className="text-xs">Auto (streamable, then SSE)</SelectItem>
                        <SelectItem value="streamable-http" className="text-xs">Streamable HTTP</SelectItem>
                        <SelectItem value="sse" className="text-xs">SSE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Anon actor query key (optional)</Label>
                    <Input
                      value={mcpActorQueryParamKey}
                      onChange={(event) => setMcpActorQueryParamKey(event.target.value)}
                      placeholder="userId"
                      className="h-8 text-xs font-mono bg-background"
                    />
                  </div>
                </>
              )}

              <Button
                onClick={handleCustomSubmit}
                disabled={submitting || !name.trim() || !endpoint.trim()}
                className="w-full h-9"
                size="sm"
              >
                {submitting ? "Adding..." : "Add Source"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Source Card ──

function ConfigureSourceAuthDialog({
  source,
  inferredProfile,
}: {
  source: ToolSourceRecord;
  inferredProfile?: SourceAuthProfile;
}) {
  const { context } = useSession();
  const upsertToolSource = useMutation(convexApi.workspace.upsertToolSource);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentAuth = readSourceAuth(source, inferredProfile);
  const editableInitialAuthType = currentAuth.type === "mixed" ? "bearer" : currentAuth.type;
  const [authType, setAuthType] = useState<Exclude<SourceAuthType, "mixed">>(editableInitialAuthType);
  const [authMode, setAuthMode] = useState<SourceAuthMode>(currentAuth.mode ?? "workspace");
  const [apiKeyHeader, setApiKeyHeader] = useState(currentAuth.header ?? "x-api-key");

  const configurable = source.type === "openapi" || source.type === "graphql";

  const resetFromSource = () => {
    const auth = readSourceAuth(source, inferredProfile);
    setAuthType(auth.type === "mixed" ? "bearer" : auth.type);
    setAuthMode(auth.mode ?? "workspace");
    setApiKeyHeader(auth.header ?? "x-api-key");
  };

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      resetFromSource();
    }
  };

  const handleSave = async () => {
    if (!context || !configurable) return;
    setSaving(true);
    try {
      const authConfig: Record<string, unknown> =
        authType === "none"
          ? { type: "none" }
          : authType === "apiKey"
            ? { type: "apiKey", mode: authMode, header: apiKeyHeader.trim() || "x-api-key" }
            : { type: authType, mode: authMode };

      await upsertToolSource({
        id: source.id,
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        name: source.name,
        type: source.type,
        config: {
          ...source.config,
          auth: authConfig,
        },
      });

      toast.success(`Updated auth for ${source.name}`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update auth");
    } finally {
      setSaving(false);
    }
  };

  if (!configurable) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-[11px]">
          <Pencil className="h-3 w-3 mr-1.5" />
          Auth
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-medium">Configure Source Auth</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Source</Label>
            <Input value={source.name} readOnly className="h-8 text-xs font-mono bg-background" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Auth Type</Label>
            <Select value={authType} onValueChange={(value) => setAuthType(value as Exclude<SourceAuthType, "mixed">)}>
              <SelectTrigger className="h-8 text-xs bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None</SelectItem>
                <SelectItem value="bearer" className="text-xs">Bearer token</SelectItem>
                <SelectItem value="apiKey" className="text-xs">API key header</SelectItem>
                <SelectItem value="basic" className="text-xs">Basic auth</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {currentAuth.inferred && (
            <p className="text-[11px] text-muted-foreground">
              Suggested from spec inference. Save to pin an explicit auth config.
            </p>
          )}

          {authType !== "none" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Credential Scope</Label>
                <Select value={authMode} onValueChange={(value) => setAuthMode(value as SourceAuthMode)}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace" className="text-xs">Workspace</SelectItem>
                    <SelectItem value="actor" className="text-xs">Per-user (actor)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {authType === "apiKey" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Header Name</Label>
                  <Input
                    value={apiKeyHeader}
                    onChange={(e) => setApiKeyHeader(e.target.value)}
                    placeholder="x-api-key"
                    className="h-8 text-xs font-mono bg-background"
                  />
                </div>
              )}

              <p className="text-[11px] text-muted-foreground">
                Save this first, then add a connection in the Connections tab using source key
                <code className="ml-1">{sourceKeyForSource(source)}</code>.
              </p>
            </>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full h-9" size="sm">
            {saving ? "Saving..." : "Save Auth"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourceCard({
  source,
  quality,
  qualityLoading,
  credentialStats,
  sourceAuthProfiles,
  selected = false,
  onFocusSource,
}: {
  source: ToolSourceRecord;
  quality?: OpenApiSourceQuality;
  qualityLoading?: boolean;
  credentialStats: { workspaceCount: number; actorCount: number };
  sourceAuthProfiles: Record<string, SourceAuthProfile>;
  selected?: boolean;
  onFocusSource?: (sourceName: string) => void;
}) {
  const { context } = useSession();
  const deleteToolSource = useMutation(convexApi.workspace.deleteToolSource);
  const [deleting, setDeleting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleDelete = async () => {
    if (!context) return;
    setDeleting(true);
    try {
      await deleteToolSource({
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        sourceId: source.id,
      });
      toast.success(`Removed "${source.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  const TypeIcon = source.type === "mcp" ? Server : Globe;
  const favicon = getSourceFavicon(source);
  const sourceKey = sourceKeyForSource(source) ?? "";
  const authBadge = formatSourceAuthBadge(source, sourceAuthProfiles[sourceKey]);
  const auth = readSourceAuth(source, sourceAuthProfiles[sourceKey]);
  const hasAuthConfigured = auth.type !== "none";
  const totalCredentials = credentialStats.workspaceCount + credentialStats.actorCount;
  const prettyName = displaySourceName(source.name);
  const compactEndpoint = compactEndpointLabel(source);
  const showTypeSummary = source.type === "openapi" && (quality || qualityLoading);

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-lg border border-border/60 bg-gradient-to-b from-muted/45 to-muted/20 px-3 py-3",
        selected && "border-primary/35 bg-primary/5",
      )}
    >
      <div className="mt-0.5 h-9 w-9 rounded-md bg-muted/80 flex items-center justify-center shrink-0 overflow-hidden">
        {favicon ? (
          <img src={favicon} alt="" width={20} height={20} className="w-5 h-5" loading="lazy" />
        ) : (
          <TypeIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate" title={source.name}>
            {prettyName}
          </span>
          <Badge
            variant="outline"
            className="text-[9px] uppercase tracking-wide"
          >
            {source.type}
          </Badge>
          {!source.enabled && (
            <Badge
              variant="outline"
              className="text-[9px] uppercase tracking-wide text-terminal-red border-terminal-red/30"
            >
              disabled
            </Badge>
          )}
          {authBadge && (
            <Badge
              variant="outline"
              className="text-[9px] uppercase tracking-wide text-primary border-primary/30"
            >
              {authBadge}
            </Badge>
          )}
          {hasAuthConfigured && (
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] uppercase tracking-wide",
                totalCredentials > 0
                  ? "text-terminal-green border-terminal-green/30"
                  : "text-terminal-amber border-terminal-amber/30",
              )}
            >
              {totalCredentials > 0 ? "connections ready" : "connection needed"}
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground truncate block mt-0.5" title={sourceEndpointLabel(source)}>
          {compactEndpoint}
        </span>
        {showTypeSummary && (
          <div className="mt-1.5 flex items-center gap-2">
            {quality ? (
              <Badge
                variant="outline"
                className={cn("text-[9px] uppercase tracking-wide", qualityToneClass(quality))}
              >
                {formatQualityPercent(quality.overallQuality)} {qualitySummaryLabel(quality)}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] uppercase tracking-wide text-muted-foreground">
                analyzing type quality
              </Badge>
            )}
          </div>
        )}
        {source.type === "openapi" && (
          <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
            <div className="mt-1.5">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-muted-foreground">
                  <ChevronRight
                    className={cn("mr-1 h-3 w-3 transition-transform", detailsOpen && "rotate-90")}
                  />
                  {detailsOpen ? "Hide details" : "View details"}
                </Button>
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent className="mt-1.5">
              <div className="rounded-md border border-border/60 bg-background/70 px-2.5 py-2">
                {quality && (
                  <div className="space-y-1.5 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Type quality</span>
                      <span className={cn("font-medium", qualityToneClass(quality))}>
                        {formatQualityPercent(quality.overallQuality)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Args quality</span>
                      <span>{formatQualityPercent(quality.argsQuality)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Returns quality</span>
                      <span>{formatQualityPercent(quality.returnsQuality)}</span>
                    </div>
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span>Inferred returns</span>
                      <span>{quality.unknownReturnsCount}</span>
                    </div>
                  </div>
                )}
                {!quality && qualityLoading && (
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Analyzing OpenAPI typing</span>
                    <span className="inline-flex items-center gap-1 text-[10px]">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/60 animate-pulse" />
                      in progress
                    </span>
                  </div>
                )}
                {!quality && !qualityLoading && (
                  <div className="text-[10px] text-muted-foreground">Type quality data unavailable.</div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
        {onFocusSource ? (
          <Button
            variant={selected ? "default" : "outline"}
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => onFocusSource(source.name)}
          >
            {selected ? "Viewing" : "View tools"}
          </Button>
        ) : null}
        <ConfigureSourceAuthDialog source={source} inferredProfile={sourceAuthProfiles[sourceKey]} />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-terminal-red"
          onClick={handleDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

type SourceOption = { source: ToolSourceRecord; key: string; label: string };

function sourceAuthForKey(
  sourceOptions: SourceOption[],
  key: string,
  inferredProfiles: Record<string, SourceAuthProfile> = {},
): {
  type: SourceAuthType;
  mode?: SourceAuthMode;
  header?: string;
  inferred?: boolean;
} {
  const match = sourceOptions.find((entry) => entry.key === key);
  if (!match) {
    return { type: "bearer" };
  }
  return readSourceAuth(match.source, inferredProfiles[key]);
}

function sourceOptionLabel(source: ToolSourceRecord): string {
  return `${source.name} (${source.type})`;
}

function providerLabel(provider: "local-convex" | "workos-vault"): string {
  return provider === "workos-vault" ? "encrypted" : "local";
}

function connectionDisplayName(
  sources: ToolSourceRecord[],
  connection: {
    scope: CredentialScope;
    sourceKeys: Set<string>;
    actorId?: string;
  },
): string {
  const sourceNames = [...connection.sourceKeys]
    .map((sourceKey) => sourceForCredentialKey(sources, sourceKey))
    .filter((source): source is ToolSourceRecord => Boolean(source))
    .map((source) => displaySourceName(source.name));

  const primary = sourceNames[0] ?? "API";
  const extraCount = Math.max(sourceNames.length - 1, 0);
  const base = extraCount > 0 ? `${primary} +${extraCount}` : primary;

  if (connection.scope === "actor") {
    if (connection.actorId) {
      return `${base} personal (${connection.actorId})`;
    }
    return `${base} personal`;
  }

  return `${base} workspace`;
}

function parseHeaderOverrides(text: string): { value?: Record<string, string>; error?: string } {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { value: {} };
  }

  const headers: Record<string, string> = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      return { error: `Invalid header line: ${line}` };
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!name || !value) {
      return { error: `Invalid header line: ${line}` };
    }
    headers[name] = value;
  }

  return { value: headers };
}

function formatHeaderOverrides(overrides: Record<string, unknown> | undefined): string {
  const headers = overrides && typeof overrides.headers === "object" ? (overrides.headers as Record<string, unknown>) : {};
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join("\n");
}

function CredentialsPanel({
  sources,
  credentials,
  sourceAuthProfiles,
  loading,
  focusSourceKey,
  onFocusHandled,
}: {
  sources: ToolSourceRecord[];
  credentials: CredentialRecord[];
  sourceAuthProfiles: Record<string, SourceAuthProfile>;
  loading: boolean;
  focusSourceKey?: string | null;
  onFocusHandled?: () => void;
}) {
  const { context, clientConfig } = useSession();
  const upsertCredential = useAction(convexApi.credentialsNode.upsertCredential);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CredentialRecord | null>(null);
  const [sourceKey, setSourceKey] = useState("");
  const [scope, setScope] = useState<CredentialScope>("workspace");
  const [actorId, setActorId] = useState("");
  const [connectionMode, setConnectionMode] = useState<"new" | "existing">("new");
  const [existingConnectionId, setExistingConnectionId] = useState("");
  const [tokenValue, setTokenValue] = useState("");
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [basicUsername, setBasicUsername] = useState("");
  const [basicPassword, setBasicPassword] = useState("");
  const [customHeadersText, setCustomHeadersText] = useState("");

  const storageCopy = clientConfig?.authProviderMode === "workos"
    ? "Stored encrypted"
    : "Stored locally on this machine";

  const sourceOptions = sources
    .map((source) => {
      const key = sourceKeyForSource(source);
      return {
        source,
        key,
        label: sourceOptionLabel(source),
      };
    })
    .filter((entry): entry is SourceOption => entry.key !== null);

  const connectionOptions = useMemo(() => {
    const grouped = new Map<string, {
      id: string;
      scope: CredentialScope;
      actorId?: string;
      provider: "local-convex" | "workos-vault";
      sourceKeys: Set<string>;
      updatedAt: number;
    }>();

    for (const credential of credentials) {
      const existing = grouped.get(credential.id);
      if (existing) {
        existing.sourceKeys.add(credential.sourceKey);
        existing.updatedAt = Math.max(existing.updatedAt, credential.updatedAt);
      } else {
        grouped.set(credential.id, {
          id: credential.id,
          scope: credential.scope,
          actorId: credential.actorId,
          provider: credential.provider,
          sourceKeys: new Set([credential.sourceKey]),
          updatedAt: credential.updatedAt,
        });
      }
    }

    return [...grouped.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [credentials]);

  const representativeCredentialByConnection = useMemo(() => {
    const map = new Map<string, CredentialRecord>();
    for (const credential of credentials) {
      if (!map.has(credential.id)) {
        map.set(credential.id, credential);
      }
    }
    return map;
  }, [credentials]);

  const selectedAuth = sourceAuthForKey(sourceOptions, sourceKey, sourceAuthProfiles);
  const compatibleConnectionOptions = connectionOptions.filter((connection) => {
    if (connection.scope !== scope) {
      return false;
    }
    if (scope === "actor") {
      return connection.actorId === actorId.trim();
    }
    return true;
  });
  const selectedAuthBadge = selectedAuth.type === "none"
    ? "none"
    : selectedAuth.type === "mixed"
      ? "mixed"
      : `${selectedAuth.type}:${selectedAuth.mode ?? "workspace"}`;

  useEffect(() => {
    if (!existingConnectionId) {
      return;
    }
    if (!compatibleConnectionOptions.some((connection) => connection.id === existingConnectionId)) {
      setExistingConnectionId("");
    }
  }, [compatibleConnectionOptions, existingConnectionId]);

  const resetForm = () => {
    const defaultSourceKey = sourceOptions[0]?.key ?? "";
    setSourceKey(defaultSourceKey);
    const defaultAuth = sourceAuthForKey(sourceOptions, defaultSourceKey, sourceAuthProfiles);
    setScope(defaultAuth.mode ?? "workspace");
    setActorId(context?.actorId ?? "");
    setConnectionMode("new");
    setExistingConnectionId("");
    setTokenValue("");
    setApiKeyValue("");
    setBasicUsername("");
    setBasicPassword("");
    setCustomHeadersText("");
    setEditing(null);
  };

  useEffect(() => {
    if (!focusSourceKey) {
      return;
    }
    resetForm();
    setSourceKey(focusSourceKey);
    const auth = sourceAuthForKey(sourceOptions, focusSourceKey, sourceAuthProfiles);
    setScope(auth.mode ?? "workspace");
    setOpen(true);
    onFocusHandled?.();
  }, [focusSourceKey, onFocusHandled, sourceAuthProfiles, sourceOptions]);

  const openForCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openForEdit = (credential: CredentialRecord) => {
    setEditing(credential);
    setSourceKey(credential.sourceKey);
    setScope(credential.scope);
    setActorId(credential.actorId ?? context?.actorId ?? "");
    setConnectionMode("new");
    setExistingConnectionId(credential.id);
    setTokenValue("");
    setApiKeyValue("");
    setBasicUsername("");
    setBasicPassword("");
    setCustomHeadersText(formatHeaderOverrides(credential.overridesJson));
    setOpen(true);
  };

  const handleSourceKeyChange = (nextSourceKey: string) => {
    setSourceKey(nextSourceKey);
    const auth = sourceAuthForKey(sourceOptions, nextSourceKey, sourceAuthProfiles);
    if (!editing) {
      setScope(auth.mode ?? "workspace");
    }
  };

  const handleSave = async () => {
    if (!context) return;
    if (!sourceKey.trim()) {
      toast.error("Source key is required");
      return;
    }
    if (scope === "actor" && !actorId.trim()) {
      toast.error("Actor ID is required for actor-scoped credentials");
      return;
    }

    const parsedHeaders = parseHeaderOverrides(customHeadersText);
    if (!parsedHeaders.value) {
      toast.error(parsedHeaders.error ?? "Invalid header overrides");
      return;
    }

    const linkExisting = !editing && connectionMode === "existing";
    if (linkExisting && !existingConnectionId) {
      toast.error("Select an existing connection to link");
      return;
    }
    if (linkExisting && !compatibleConnectionOptions.some((connection) => connection.id === existingConnectionId)) {
      toast.error("Selected connection does not match this scope");
      return;
    }

    if (selectedAuth.type === "none") {
      toast.error("This source does not require auth");
      return;
    }

    if (selectedAuth.type === "mixed" && !linkExisting && !editing) {
      toast.error("Mixed-auth sources must link to an existing connection");
      return;
    }

    const secretJson: Record<string, unknown> = {};
    if (!linkExisting) {
      if (selectedAuth.type === "basic") {
        const hasUsername = basicUsername.trim().length > 0;
        const hasPassword = basicPassword.trim().length > 0;
        if (hasUsername || hasPassword) {
          if (!hasUsername || !hasPassword) {
            toast.error("Username and password are required for basic auth");
            return;
          }
          secretJson.username = basicUsername;
          secretJson.password = basicPassword;
        }
      } else if (selectedAuth.type === "apiKey") {
        if (apiKeyValue.trim()) {
          secretJson.value = apiKeyValue.trim();
        }
      } else if (selectedAuth.type === "bearer") {
        if (tokenValue.trim()) {
          secretJson.token = tokenValue.trim();
        }
      }
    }

    if (Object.keys(parsedHeaders.value).length > 0) {
      secretJson.__headers = parsedHeaders.value;
    }

    if (Object.keys(secretJson).length === 0 && !editing && !linkExisting) {
      if (selectedAuth.type === "basic") {
        toast.error("Username and password are required");
      } else if (selectedAuth.type === "apiKey") {
        toast.error("API key value is required");
      } else {
        toast.error("Token is required");
      }
      return;
    }

    setSaving(true);
    try {
      await upsertCredential({
        ...(editing ? { id: editing.id } : linkExisting ? { id: existingConnectionId } : {}),
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        sourceKey: sourceKey.trim(),
        scope,
        ...(scope === "actor" ? { actorId: actorId.trim() } : {}),
        secretJson,
      });

      toast.success(editing ? "Connection updated" : linkExisting ? "Connection linked" : "Connection saved");
      setOpen(false);
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save connection");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            Connections
          </CardTitle>
          <Button size="sm" className="h-8 text-xs" onClick={openForCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Connection
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        ) : connectionOptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <KeyRound className="h-5 w-5 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">No connections configured</p>
            <p className="text-[11px] text-muted-foreground/70 text-center max-w-md">
              Add a source, then create or link a reusable connection.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {connectionOptions.map((connection) => {
              const representative = representativeCredentialByConnection.get(connection.id);
              if (!representative) return null;
              const firstSource = sourceForCredentialKey(sources, representative.sourceKey);
              const favicon = firstSource ? getSourceFavicon(firstSource) : null;

              return (
                <div
                  key={connection.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md bg-muted/40"
                >
                  <div className="h-8 w-8 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {favicon ? (
                      <img src={favicon} alt="" width={20} height={20} className="w-5 h-5" loading="lazy" />
                    ) : (
                      <KeyRound className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                      <span className="text-sm font-medium">{connectionDisplayName(sources, connection)}</span>
                      <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">
                        {connection.scope}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">
                        {providerLabel(connection.provider)}
                      </Badge>
                      {connection.scope === "actor" && connection.actorId && (
                        <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {connection.actorId}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Linked to {connection.sourceKeys.size} source{connection.sourceKeys.size === 1 ? "" : "s"} • {storageCopy}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      ID: <span className="font-mono">{connection.id}</span> •
                      {" "}
                      Updated {new Date(connection.updatedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => openForEdit(representative)}
                  >
                    Edit
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">
              {editing ? "Edit Connection" : "Add Connection"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Source</Label>
              {sourceOptions.length > 0 ? (
                <Select value={sourceKey} onValueChange={handleSourceKeyChange}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceOptions.map((entry) => (
                      <SelectItem key={entry.key} value={entry.key} className="text-xs">
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={sourceKey}
                  onChange={(e) => handleSourceKeyChange(e.target.value)}
                  placeholder="source:<source-id>"
                  className="h-8 text-xs font-mono bg-background"
                />
              )}
              {sourceKey && (
                <p className="text-[10px] text-muted-foreground font-mono">key: {sourceKey}</p>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-muted-foreground">Detected auth</span>
              <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">
                {selectedAuthBadge}
              </Badge>
              {selectedAuth.inferred && (
                <Badge variant="outline" className="text-[9px] font-mono uppercase tracking-wider">
                  inferred
                </Badge>
              )}
              {selectedAuth.type === "apiKey" && selectedAuth.header && (
                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  header: {selectedAuth.header}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Scope</Label>
                <Select value={scope} onValueChange={(value) => setScope(value as CredentialScope)}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace" className="text-xs">Workspace</SelectItem>
                    <SelectItem value="actor" className="text-xs">Per-user (actor)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Storage</Label>
                <Input value={storageCopy} readOnly className="h-8 text-xs bg-background" />
              </div>
            </div>

            {scope === "actor" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Actor ID</Label>
                <Input
                  value={actorId}
                  onChange={(e) => setActorId(e.target.value)}
                  placeholder="actor_123"
                  className="h-8 text-xs font-mono bg-background"
                />
              </div>
            )}

            {!editing && connectionOptions.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Connection Mode</Label>
                <Select value={connectionMode} onValueChange={(value) => setConnectionMode(value as "new" | "existing") }>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new" className="text-xs">Create new connection</SelectItem>
                    <SelectItem value="existing" className="text-xs">Use existing connection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {!editing && connectionMode === "existing" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Existing Connection</Label>
                <Select value={existingConnectionId} onValueChange={setExistingConnectionId}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue placeholder="Select a connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {compatibleConnectionOptions.map((connection) => (
                      <SelectItem key={connection.id} value={connection.id} className="text-xs">
                        {connectionDisplayName(sources, connection)} ({connection.sourceKeys.size} source{connection.sourceKeys.size === 1 ? "" : "s"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {compatibleConnectionOptions.length === 0 && (
                  <p className="text-[10px] text-muted-foreground">No compatible existing connections for this scope.</p>
                )}
              </div>
            )}

            {(editing || connectionMode === "new") && (
              <>
                {editing && (
                  <p className="text-[11px] text-muted-foreground">
                    Stored secret is hidden. Enter a new value to rotate it, or leave fields blank to keep it.
                  </p>
                )}

                {selectedAuth.type === "none" ? (
                  <p className="text-[11px] text-terminal-amber">This source does not currently require auth.</p>
                ) : selectedAuth.type === "mixed" ? (
                  <p className="text-[11px] text-terminal-amber">
                    This source has mixed auth requirements. Link an existing connection for now.
                  </p>
                ) : selectedAuth.type === "apiKey" ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">API Key Value</Label>
                    <Input
                      value={apiKeyValue}
                      onChange={(e) => setApiKeyValue(e.target.value)}
                      placeholder="sk_live_..."
                      className="h-8 text-xs font-mono bg-background"
                    />
                  </div>
                ) : selectedAuth.type === "basic" ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Username</Label>
                      <Input
                        value={basicUsername}
                        onChange={(e) => setBasicUsername(e.target.value)}
                        className="h-8 text-xs font-mono bg-background"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Password</Label>
                      <Input
                        type="password"
                        value={basicPassword}
                        onChange={(e) => setBasicPassword(e.target.value)}
                        className="h-8 text-xs font-mono bg-background"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Bearer Token</Label>
                    <Input
                      type="password"
                      value={tokenValue}
                      onChange={(e) => setTokenValue(e.target.value)}
                      placeholder="ghp_..."
                      className="h-8 text-xs font-mono bg-background"
                    />
                  </div>
                )}
              </>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Custom Headers (optional)</Label>
              <Textarea
                value={customHeadersText}
                onChange={(e) => setCustomHeadersText(e.target.value)}
                rows={4}
                placeholder="x-tenant-id: acme\nx-env: staging"
                className="text-xs font-mono bg-background"
              />
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full h-9" size="sm">
              {saving ? "Saving..." : editing ? "Update Connection" : connectionMode === "existing" ? "Link Connection" : "Save Connection"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Tool Inventory (legacy removed — replaced by ToolExplorer) ──

// ── Tools View ──

export function ToolsView({ initialSource }: { initialSource?: string | null }) {
  const { context, loading: sessionLoading } = useSession();
  const [selectedSource, setSelectedSource] = useState<string | null>(initialSource ?? null);
  const [activeTab, setActiveTab] = useState<"catalog" | "credentials" | "mcp">("catalog");
  const [focusCredentialSourceKey, setFocusCredentialSourceKey] = useState<string | null>(null);

  const sources = useQuery(
    convexApi.workspace.listToolSources,
    context ? { workspaceId: context.workspaceId, sessionId: context.sessionId } : "skip",
  );
  const sourceItems: ToolSourceRecord[] = sources ?? [];
  const sourcesLoading = !!context && sources === undefined;

  const credentials = useQuery(
    convexApi.workspace.listCredentials,
    context ? { workspaceId: context.workspaceId, sessionId: context.sessionId } : "skip",
  );
  const credentialItems: CredentialRecord[] = credentials ?? [];
  const credentialsLoading = !!context && credentials === undefined;

  const {
    tools,
    warnings,
    sourceQuality,
    sourceAuthProfiles,
    loadingTools,
    refreshingTools,
  } = useWorkspaceTools(context ?? null);
  const selectedSourceRecord = selectedSource
    ? sourceItems.find((source) => source.name === selectedSource) ?? null
    : null;

  if (sessionLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <PageHeader
        title="Tools"
        description="Manage sources, auth, connections, and available tools"
      />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as "catalog" | "credentials" | "mcp")}
        className="w-full min-h-0 flex-1"
      >
        <TabsList className="bg-muted/50 h-9">
          <TabsTrigger value="catalog" className="text-xs data-[state=active]:bg-background">
            Catalog
            <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">
              {loadingTools ? "..." : tools.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="credentials" className="text-xs data-[state=active]:bg-background">
            Connections
            {credentials && (
              <span className="ml-1.5 text-[10px] font-mono text-muted-foreground">
                {new Set(credentialItems.map((credential) => credential.id)).size}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="mcp" className="text-xs data-[state=active]:bg-background">
            MCP Setup
          </TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4 min-h-0">
          <Card className="bg-card border-border min-h-0 flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  Tools + Sources
                  <span className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                    {loadingTools ? "..." : tools.length}
                  </span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  {selectedSource ? (
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => setSelectedSource(null)}>
                      Clear source filter
                    </Button>
                  ) : null}
                  <AddSourceDialog
                    existingSourceNames={new Set(sourceItems.map((s) => s.name))}
                    onSourceAdded={(source) => {
                      setActiveTab("credentials");
                      setSelectedSource(source.name);
                      const key = sourceKeyForSource(source);
                      if (key) {
                        setFocusCredentialSourceKey(key);
                      }
                    }}
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {selectedSource
                  ? `Filtering and managing ${selectedSource}.`
                  : "Source management and tool inventory are unified here."}
              </p>
            </CardHeader>
            <CardContent className="pt-0 min-h-0 flex-1 flex flex-col gap-3">
              {sourcesLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-16" />
                  ))}
                </div>
              ) : null}

              {!sourcesLoading && sourceItems.length === 0 ? (
                <div className="rounded-md border border-border/70 bg-muted/30 px-3 py-2.5">
                  <p className="text-[11px] text-muted-foreground">
                    No external sources yet. Add MCP, OpenAPI, or GraphQL to expand available tools.
                  </p>
                </div>
              ) : null}

              {selectedSourceRecord ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Selected source</p>
                  <SourceCard
                    source={selectedSourceRecord}
                    quality={sourceQuality[toolSourceLabelForSource(selectedSourceRecord)]}
                    qualityLoading={selectedSourceRecord.type === "openapi" && !sourceQuality[toolSourceLabelForSource(selectedSourceRecord)] && refreshingTools}
                    credentialStats={credentialStatsForSource(selectedSourceRecord, credentialItems)}
                    sourceAuthProfiles={sourceAuthProfiles}
                    selected
                    onFocusSource={setSelectedSource}
                  />
                </div>
              ) : null}

              <div className="min-h-0 flex-1">
                <ToolExplorer
                  tools={tools}
                  sources={sourceItems}
                  loading={loadingTools}
                  warnings={warnings}
                  initialSource={initialSource}
                  activeSource={selectedSource}
                  onActiveSourceChange={setSelectedSource}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="credentials" className="mt-4">
          <CredentialsPanel
            sources={sourceItems}
            credentials={credentialItems}
            sourceAuthProfiles={sourceAuthProfiles}
            loading={credentialsLoading || sourcesLoading}
            focusSourceKey={focusCredentialSourceKey}
            onFocusHandled={() => setFocusCredentialSourceKey(null)}
          />
        </TabsContent>

        <TabsContent value="mcp" className="mt-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                MCP Client Installation
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <McpSetupCard
                workspaceId={context?.workspaceId}
                actorId={context?.actorId}
                sessionId={context?.sessionId}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
