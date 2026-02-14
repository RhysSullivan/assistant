export function sanitizeSegment(value: string): string {
  const cleanedBase = value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const cleaned = cleanedBase.length > 0 ? cleanedBase : "default";
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function sanitizeSnakeSegment(value: string): string {
  const withWordBreaks = value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([A-Za-z])([0-9])/g, "$1_$2")
    .replace(/([0-9])([A-Za-z])/g, "$1_$2");

  return sanitizeSegment(withWordBreaks);
}
