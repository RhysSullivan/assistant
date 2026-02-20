import { externalOriginFromRequest } from "./http/request-origin";

const WORKOS_REDIRECT_PATH = "/callback";

function trim(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}

function fallbackWorkosOriginFromServer(): string | undefined {
  if (trim(process.env.EXECUTOR_PUBLIC_ORIGIN)) {
    return trim(process.env.EXECUTOR_PUBLIC_ORIGIN);
  }

  const vercelHost = trim(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    ?? trim(process.env.VERCEL_URL)
    ?? trim(process.env.NEXT_PUBLIC_VERCEL_URL);

  if (vercelHost) {
    return vercelHost.startsWith("http://") || vercelHost.startsWith("https://")
      ? vercelHost
      : `https://${vercelHost}`;
  }

  if (trim(process.env.NODE_ENV) !== "production") {
    return `http://localhost:${trim(process.env.PORT) ?? "4312"}`;
  }

  return undefined;
}

export function resolveWorkosRedirectUri(request?: Request): string | undefined {
  const explicitRedirect = trim(process.env.WORKOS_REDIRECT_URI);
  if (explicitRedirect) {
    return explicitRedirect;
  }

  const publicRedirect = trim(process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI);
  if (publicRedirect) {
    return publicRedirect;
  }

  const origin = request
    ? externalOriginFromRequest(request)
    : fallbackWorkosOriginFromServer();

  return origin ? `${origin}${WORKOS_REDIRECT_PATH}` : undefined;
}
