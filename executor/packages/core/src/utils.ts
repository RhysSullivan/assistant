/**
 * Runtime guard for plain object payloads.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Convert a runtime value into a plain object record, or return undefined.
 */
export function toPlainObject(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

/**
 * Extract a human-readable message from an unknown thrown value.
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
