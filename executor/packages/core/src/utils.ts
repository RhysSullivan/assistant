/**
 * Safely cast an unknown value to a Record<string, unknown>.
 * Returns an empty object for nullish, non-object, or array values.
 */
export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

/**
 * Extract a human-readable message from an unknown thrown value.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
