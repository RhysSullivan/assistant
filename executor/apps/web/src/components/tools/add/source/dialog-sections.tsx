import { ChevronRight, Plus } from "lucide-react";
import { Streamdown } from "streamdown";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { CatalogCollectionItem } from "@/lib/catalog-collections";
import {
  endpointLabelForType,
  endpointPlaceholderForType,
  type SourceCatalogSort,
  type SourceType,
} from "./dialog-helpers";
import { SourceFavicon } from "../../source-favicon";

export function CatalogViewSection({
  catalogQuery,
  onCatalogQueryChange,
  catalogSort,
  onCatalogSortChange,
  visibleCatalogItems,
  onSwitchToCustom,
  onAddCatalog,
}: {
  catalogQuery: string;
  onCatalogQueryChange: (value: string) => void;
  catalogSort: SourceCatalogSort;
  onCatalogSortChange: (value: SourceCatalogSort) => void;
  visibleCatalogItems: CatalogCollectionItem[];
  onSwitchToCustom: () => void;
  onAddCatalog: (item: CatalogCollectionItem) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          value={catalogQuery}
          onChange={(event) => onCatalogQueryChange(event.target.value)}
          placeholder="Search APIs"
          className="h-8 text-xs font-mono bg-background flex-1 min-w-[150px]"
        />
        <Select value={catalogSort} onValueChange={(value) => onCatalogSortChange(value as SourceCatalogSort)}>
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
          onClick={onSwitchToCustom}
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
            {item.logoUrl ? (
              <img
                src={item.logoUrl}
                alt=""
                className="w-5 h-5 rounded shrink-0 mt-0.5 object-contain"
              />
            ) : (
              <SourceFavicon
                sourceUrl={item.originUrl || item.specUrl}
                fallbackType={item.sourceType ?? "openapi"}
                iconClassName="h-5 w-5 text-muted-foreground"
                imageClassName="w-5 h-5 rounded object-contain"
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
                onClick={() => onAddCatalog(item)}
              >
                Use
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
  );
}

export function CustomViewSection({
  type,
  onTypeChange,
  typeDisabled = false,
  endpoint,
  onEndpointChange,
  name,
  onNameChange,
  baseUrl,
  baseUrlOptions,
  onBaseUrlChange,
  mcpTransport,
  onMcpTransportChange,
  submitting,
  submittingLabel,
  submitDisabled,
  submitLabel,
  showBackToCatalog = true,
  onBackToCatalog,
  onSubmit,
  children,
}: {
  type: SourceType;
  onTypeChange: (value: SourceType) => void;
  typeDisabled?: boolean;
  endpoint: string;
  onEndpointChange: (value: string) => void;
  name: string;
  onNameChange: (value: string) => void;
  baseUrl: string;
  baseUrlOptions: string[];
  onBaseUrlChange: (value: string) => void;
  mcpTransport: "auto" | "streamable-http" | "sse";
  onMcpTransportChange: (value: "auto" | "streamable-http" | "sse") => void;
  submitting: boolean;
  submittingLabel?: string;
  submitDisabled: boolean;
  submitLabel?: string;
  showBackToCatalog?: boolean;
  onBackToCatalog?: () => void;
  onSubmit: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {showBackToCatalog && onBackToCatalog ? (
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onBackToCatalog}>
          <ChevronRight className="h-3.5 w-3.5 mr-1 rotate-180" />
          Back to API list
        </Button>
      ) : null}

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Type</Label>
        <Select value={type} onValueChange={(value) => onTypeChange(value as SourceType)} disabled={typeDisabled}>
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
        <Label className="text-xs text-muted-foreground">{endpointLabelForType(type)}</Label>
        <Input
          value={endpoint}
          onChange={(event) => onEndpointChange(event.target.value)}
          placeholder={endpointPlaceholderForType(type)}
          className="h-8 text-xs font-mono bg-background"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Name</Label>
        <Input
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="e.g. my-service"
          className="h-8 text-xs font-mono bg-background"
        />
      </div>

      {type === "openapi" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Base URL (optional)</Label>
          <Input
            value={baseUrl}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            list={baseUrlOptions.length > 0 ? "openapi-base-url-options" : undefined}
            placeholder="https://api.example.com"
            className="h-8 text-xs font-mono bg-background"
          />
          {baseUrlOptions.length > 0 ? (
            <datalist id="openapi-base-url-options">
              {baseUrlOptions.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          ) : null}
        </div>
      )}

      {type === "mcp" && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Transport</Label>
          <Select
            value={mcpTransport}
            onValueChange={(value) => onMcpTransportChange(value as "auto" | "streamable-http" | "sse")}
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
      )}

      {children}

      <Button onClick={onSubmit} disabled={submitDisabled} className="w-full h-9" size="sm">
        {submitting ? submittingLabel ?? "Adding..." : submitLabel ?? "Add Source"}
      </Button>
    </div>
  );
}
