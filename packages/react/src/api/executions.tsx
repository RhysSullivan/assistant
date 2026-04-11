import { endOfDay, parseISO, startOfDay } from "date-fns";
import type {
  Execution,
  ExecutionChartBucket,
  ExecutionInteraction,
  ExecutionListMeta,
} from "@executor/sdk";

import { getBaseUrl } from "./base-url";

export type ExecutionListItem = Execution & {
  readonly pendingInteraction: ExecutionInteraction | null;
};

export type ListExecutionsResponse = {
  readonly executions: readonly ExecutionListItem[];
  readonly nextCursor?: string;
  readonly meta?: ExecutionListMeta;
};

export type { ExecutionChartBucket, ExecutionListMeta };

export type GetExecutionResponse = {
  readonly execution: Execution;
  readonly pendingInteraction: ExecutionInteraction | null;
};

export type RunsQueryInput = {
  readonly limit: number;
  readonly cursor?: string;
  readonly status?: string;
  readonly from?: string;
  readonly to?: string;
  readonly code?: string;
};

const toEpochRange = (date: string | undefined, mode: "start" | "end"): number | undefined => {
  if (!date) return undefined;

  try {
    const parsed = parseISO(date);
    return mode === "start" ? startOfDay(parsed).getTime() : endOfDay(parsed).getTime();
  } catch {
    return undefined;
  }
};

const readJson = async <T,>(response: Response): Promise<T> => {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
};

export const listExecutions = async (input: RunsQueryInput): Promise<ListExecutionsResponse> => {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit));

  if (input.cursor) params.set("cursor", input.cursor);
  if (input.status) params.set("status", input.status);

  const from = toEpochRange(input.from, "start");
  const to = toEpochRange(input.to, "end");
  if (from !== undefined) params.set("from", String(from));
  if (to !== undefined) params.set("to", String(to));
  if (input.code?.trim()) params.set("code", input.code.trim());

  const response = await fetch(`${getBaseUrl()}/executions?${params.toString()}`, {
    credentials: "include",
  });

  return readJson<ListExecutionsResponse>(response);
};

export const getExecution = async (executionId: string): Promise<GetExecutionResponse> => {
  const response = await fetch(`${getBaseUrl()}/executions/${executionId}`, {
    credentials: "include",
  });

  return readJson<GetExecutionResponse>(response);
};
