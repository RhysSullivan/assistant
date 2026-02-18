export function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function asTrimmedStringArray(value: unknown): string[] | undefined {
  if (typeof value === "string") {
    const single = asTrimmedString(value);
    return single ? [single] : undefined;
  }

  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value
    .map((item) => asTrimmedString(item))
    .filter((item): item is string => item !== undefined);

  return values.length > 0 ? values : undefined;
}
