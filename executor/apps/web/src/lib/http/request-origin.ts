function firstHeaderValue(value: string | null): string {
  if (!value) {
    return "";
  }

  return value.split(",")[0]?.trim() ?? "";
}

function normalizeOrigin(candidateHost: string, candidateProto: string): string | undefined {
  const parsed = candidateHost && candidateProto
    ? { value: `${candidateProto}://${candidateHost}` }
    : null;

  if (!parsed) {
    return undefined;
  }

  try {
    return new URL(parsed.value).origin;
  } catch {
    return undefined;
  }
}

export function externalOriginFromRequest(request: Request): string {
  const requestUrl = new URL(request.url);
  const host = firstHeaderValue(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  const proto = firstHeaderValue(request.headers.get("x-forwarded-proto"))
    || requestUrl.protocol.replace(":", "");

  const normalized = normalizeOrigin(host, proto);
  if (normalized) {
    return normalized;
  }

  return requestUrl.origin;
}
