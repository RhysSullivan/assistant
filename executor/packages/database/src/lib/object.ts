import { z } from "zod";

const recordSchema = z.record(z.unknown());

export function isRecord(value: unknown): value is Record<string, unknown> {
  return recordSchema.safeParse(value).success;
}

export function toRecord(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}
