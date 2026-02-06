import type { ToolCallReceipt } from "@openassistant/core";
import type { AgentCodeRun } from "./agent-loop.js";

export interface FormattedDiscordResponse {
  message: string;
  footer?: string;
}

export function formatDiscordResponse(params: {
  prompt: string;
  text: string;
  planner: string;
  provider: "claude";
  runs: AgentCodeRun[];
}): FormattedDiscordResponse {
  const { text, planner, provider, runs } = params;
  const receipts = runs.flatMap((run) => run.result.receipts);
  const stats = summarizeReceipts(receipts);
  const failures = summarizeFailures(runs);

  const messageSections: string[] = [];
  messageSections.push(buildPrimaryReply(text, receipts, stats));

  const issueSummary = buildIssueSummary(stats, failures);
  if (issueSummary) {
    messageSections.push(issueSummary);
  }

  const footerParts: string[] = [];
  const toolFooter = buildToolFooter(receipts, stats);
  if (toolFooter) {
    footerParts.push(toolFooter);
  }

  if (isVerboseMode()) {
    footerParts.push(`debug: ${provider} - ${planner}`);
    footerParts.push(`runs: ${runs.length}`);
    footerParts.push(`tools: ${formatToolStats(stats.byTool)}`);
    footerParts.push(
      failures.length > 0
        ? `failures: ${failures.map((failure) => failure.message).join(" | ")}`
        : "failures: none",
    );
  }

  return {
    message: truncateDiscord(messageSections.filter((value) => value.trim().length > 0).join("\n\n")),
    ...(footerParts.length > 0 ? { footer: truncateFooter(footerParts.join(" | ")) } : {}),
  };
}

type ToolStats = {
  calls: number;
  approved: number;
  auto: number;
  denied: number;
  succeeded: number;
  failed: number;
};

type ReceiptSummary = {
  totals: ToolStats;
  byTool: Map<string, ToolStats>;
};

type FailureEntry = {
  message: string;
};

function summarizeReceipts(receipts: ToolCallReceipt[]): ReceiptSummary {
  const totals: ToolStats = {
    calls: 0,
    approved: 0,
    auto: 0,
    denied: 0,
    succeeded: 0,
    failed: 0,
  };

  const byTool = new Map<string, ToolStats>();

  for (const receipt of receipts) {
    totals.calls += 1;
    if (receipt.decision === "approved") {
      totals.approved += 1;
    } else if (receipt.decision === "auto") {
      totals.auto += 1;
    } else {
      totals.denied += 1;
    }

    if (receipt.status === "succeeded") {
      totals.succeeded += 1;
    } else if (receipt.status === "failed") {
      totals.failed += 1;
    } else {
      totals.denied += 1;
    }

    const current = byTool.get(receipt.toolPath) ?? {
      calls: 0,
      approved: 0,
      auto: 0,
      denied: 0,
      succeeded: 0,
      failed: 0,
    };

    current.calls += 1;
    if (receipt.decision === "approved") {
      current.approved += 1;
    } else if (receipt.decision === "auto") {
      current.auto += 1;
    } else {
      current.denied += 1;
    }

    if (receipt.status === "succeeded") {
      current.succeeded += 1;
    } else if (receipt.status === "failed") {
      current.failed += 1;
    } else {
      current.denied += 1;
    }

    byTool.set(receipt.toolPath, current);
  }

  return { totals, byTool };
}

function summarizeFailures(runs: AgentCodeRun[]): FailureEntry[] {
  const failures: FailureEntry[] = [];
  for (const run of runs) {
    if (!run.result.ok) {
      failures.push({ message: run.result.error });
    }

    for (const receipt of run.result.receipts) {
      if (receipt.status === "failed") {
        failures.push({
          message: `${receipt.toolPath} failed${receipt.error ? `: ${receipt.error}` : ""}`,
        });
      }
      if (receipt.status === "denied") {
        failures.push({
          message: `${receipt.toolPath} was denied`,
        });
      }
    }
  }
  return failures;
}

function buildPrimaryReply(text: string, receipts: ToolCallReceipt[], stats: ReceiptSummary): string {
  const calendarUpdates = extractCalendarUpdates(receipts);
  if (calendarUpdates.length > 0) {
    const header =
      calendarUpdates.length === 1
        ? "Added 1 calendar event."
        : `Added ${calendarUpdates.length} calendar events.`;
    const lines = [header, ...calendarUpdates.map((entry) => `- ${entry.title} - ${formatIsoUtc(entry.startsAt)}`)];
    return lines.join("\n");
  }

  if (stats.totals.succeeded > 0) {
    return text.trim() || "Completed.";
  }

  return "I couldn't complete that request.";
}

function buildToolFooter(receipts: ToolCallReceipt[], stats: ReceiptSummary): string | null {
  if (receipts.length === 0) {
    return null;
  }

  const parts: string[] = [];
  parts.push(`${stats.totals.calls} tool call${stats.totals.calls === 1 ? "" : "s"}`);
  if (stats.totals.approved > 0) {
    parts.push(`${stats.totals.approved} approved`);
  }
  if (stats.totals.auto > 0) {
    parts.push(`${stats.totals.auto} auto`);
  }
  if (stats.totals.failed > 0) {
    parts.push(`${stats.totals.failed} failed`);
  }
  if (stats.totals.denied > 0) {
    parts.push(`${stats.totals.denied} denied`);
  }

  return `Activity: ${parts.join(", ")}.`;
}

function buildIssueSummary(stats: ReceiptSummary, failures: FailureEntry[]): string | null {
  if (failures.length === 0) {
    return null;
  }

  if (stats.totals.succeeded > 0) {
    return `Recovered from ${failures.length} issue${failures.length === 1 ? "" : "s"} during execution.`;
  }

  const top = failures.slice(0, 2).map((failure) => `- ${failure.message}`);
  return ["I hit an issue:", ...top].join("\n");
}

function extractCalendarUpdates(receipts: ToolCallReceipt[]): Array<{ title: string; startsAt: string }> {
  const updates: Array<{ title: string; startsAt: string }> = [];

  for (const receipt of receipts) {
    if (receipt.toolPath !== "calendar.update" || receipt.status !== "succeeded") {
      continue;
    }
    const preview = receipt.inputPreview;
    if (!preview) {
      continue;
    }
    const split = preview.lastIndexOf(" @ ");
    if (split <= 0 || split >= preview.length - 3) {
      continue;
    }

    const title = preview.slice(0, split).trim();
    const startsAt = preview.slice(split + 3).trim();
    if (!title || !startsAt) {
      continue;
    }

    updates.push({ title, startsAt });
  }

  return updates;
}

function formatIsoUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date) + " UTC";
}

function formatToolStats(byTool: Map<string, ToolStats>): string {
  if (byTool.size === 0) {
    return "none";
  }
  return Array.from(byTool.entries())
    .map(([tool, stat]) => `${tool}: ${stat.calls} calls, ${stat.succeeded} succeeded${stat.failed ? `, ${stat.failed} failed` : ""}${stat.denied ? `, ${stat.denied} denied` : ""}`)
    .join("; ");
}

function isVerboseMode(): boolean {
  const value = readEnv("OPENASSISTANT_VERBOSE_RESPONSE")?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function readEnv(key: string): string | undefined {
  const bun = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun;
  return bun?.env?.[key] ?? process.env[key];
}

function truncateDiscord(value: string): string {
  const limit = 1_900;
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...`;
}

function truncateFooter(value: string): string {
  const limit = 350;
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 3)}...`;
}
