import type { ToolCallReceipt } from "@openassistant/core";
import type { AgentCodeRun } from "./agent-loop.js";

export function formatDiscordResponse(params: {
  prompt: string;
  text: string;
  planner: string;
  provider: "claude";
  runs: AgentCodeRun[];
}): string {
  const { prompt, text, planner, provider, runs } = params;
  const receiptSummary = summarizeReceipts(runs.flatMap((run) => run.result.receipts));

  const sections = [
    `Request: ${prompt}`,
    `Reply: ${text || "(no text returned)"}`,
    `Planner: ${provider} - ${planner}`,
    `Code runs: ${runs.length}`,
    `Tool activity:\n${receiptSummary}`,
  ];

  const failures = formatFailures(runs);
  if (failures) {
    sections.push(`Failures:\n${failures}`);
  }

  return truncateDiscord(sections.join("\n\n"));
}

function summarizeReceipts(receipts: ToolCallReceipt[]): string {
  if (receipts.length === 0) {
    return "- none";
  }

  const byTool = new Map<
    string,
    {
      calls: number;
      approved: number;
      auto: number;
      denied: number;
      deniedDecision: number;
      succeeded: number;
      failed: number;
    }
  >();

  for (const receipt of receipts) {
    const current = byTool.get(receipt.toolPath) ?? {
      calls: 0,
      approved: 0,
      auto: 0,
      denied: 0,
      deniedDecision: 0,
      succeeded: 0,
      failed: 0,
    };

    current.calls += 1;
    if (receipt.decision === "approved") {
      current.approved += 1;
    } else if (receipt.decision === "auto") {
      current.auto += 1;
    } else {
      current.deniedDecision += 1;
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

  return Array.from(byTool.entries())
    .map(([toolPath, stats]) => {
      const parts = [`${stats.calls} call${stats.calls === 1 ? "" : "s"}`];
      parts.push(`${stats.succeeded} succeeded`);
      if (stats.approved > 0) {
        parts.push(`${stats.approved} approved`);
      }
      if (stats.auto > 0) {
        parts.push(`${stats.auto} auto`);
      }
      if (stats.denied > 0) {
        parts.push(`${stats.denied} denied`);
      }
      if (stats.deniedDecision > 0) {
        parts.push(`${stats.deniedDecision} denied-decision`);
      }
      if (stats.failed > 0) {
        parts.push(`${stats.failed} failed`);
      }
      return `- \`${toolPath}\`: ${parts.join(", ")}`;
    })
    .join("\n");
}

function formatFailures(runs: AgentCodeRun[]): string | null {
  const failures: string[] = [];

  for (const run of runs) {
    if (!run.result.ok) {
      failures.push(`- code run failed: ${run.result.error}`);
    }

    for (const receipt of run.result.receipts) {
      if (receipt.status === "failed") {
        failures.push(`- \`${receipt.toolPath}\` failed (${receipt.callId})${receipt.error ? `: ${receipt.error}` : ""}`);
      }
      if (receipt.status === "denied") {
        failures.push(`- \`${receipt.toolPath}\` denied (${receipt.callId})`);
      }
    }
  }

  return failures.length > 0 ? failures.join("\n") : null;
}

function truncateDiscord(value: string): string {
  const limit = 1_900;
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n...`;
}
