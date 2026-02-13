"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { OpenApiSourceQuality } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  formatQualityPercent,
  qualitySummaryLabel,
  qualityToneClass,
} from "@/lib/tools-source-helpers";

export function SourceQualitySummary({
  quality,
  qualityLoading,
}: {
  quality?: OpenApiSourceQuality;
  qualityLoading?: boolean;
}) {
  if (!quality && !qualityLoading) {
    return null;
  }

  return (
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
  );
}

export function OpenApiQualityDetails({
  quality,
  qualityLoading,
}: {
  quality?: OpenApiSourceQuality;
  qualityLoading?: boolean;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
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
  );
}
