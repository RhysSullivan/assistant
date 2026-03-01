const trim = (value: string | undefined): string | undefined => {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
};

const isTruthy = (value: string | undefined): boolean => {
  const normalized = trim(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export const isLocalControlPlaneUpstream = (): boolean => {
  const upstream = trim(process.env.CONTROL_PLANE_UPSTREAM_URL) ?? "http://127.0.0.1:8788";

  try {
    const url = new URL(upstream);
    return (
      url.hostname === "127.0.0.1"
      || url.hostname === "localhost"
      || url.hostname === "0.0.0.0"
      || url.hostname === "::1"
      || url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
};

export const isWorkosEnabled = (): boolean => {
  if (isTruthy(process.env.WORKOS_FORCE_ENABLED)) {
    return Boolean(trim(process.env.WORKOS_CLIENT_ID) && trim(process.env.WORKOS_API_KEY));
  }

  if (isLocalControlPlaneUpstream()) {
    return false;
  }

  return Boolean(trim(process.env.WORKOS_CLIENT_ID) && trim(process.env.WORKOS_API_KEY));
};

export const externalOriginFromRequest = (request: Request): string => {
  const forwardedHost = trim(request.headers.get("x-forwarded-host") ?? undefined);
  const forwardedProto = trim(request.headers.get("x-forwarded-proto") ?? undefined);

  if (forwardedHost) {
    const protocol = forwardedProto ?? "https";
    return `${protocol}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
};

const fallbackOrigin = (): string | undefined => {
  const explicit = trim(process.env.NEXT_PUBLIC_APP_ORIGIN);
  if (explicit) {
    return explicit;
  }

  const vercelHost = trim(process.env.VERCEL_PROJECT_PRODUCTION_URL) ?? trim(process.env.VERCEL_URL);
  if (vercelHost) {
    return vercelHost.startsWith("http://") || vercelHost.startsWith("https://")
      ? vercelHost
      : `https://${vercelHost}`;
  }

  if (trim(process.env.NODE_ENV) !== "production") {
    return "http://localhost:4312";
  }

  return undefined;
};

export const resolveWorkosRedirectUri = (request?: Request): string | undefined => {
  const explicitRedirect = trim(process.env.WORKOS_REDIRECT_URI);
  if (explicitRedirect) {
    return explicitRedirect;
  }

  const publicRedirect = trim(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI);
  if (publicRedirect) {
    return publicRedirect;
  }

  const origin = request ? externalOriginFromRequest(request) : fallbackOrigin();
  return origin ? `${origin}/callback` : undefined;
};
