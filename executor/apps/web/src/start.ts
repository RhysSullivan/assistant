import { createStart } from "@tanstack/react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";
import { resolveWorkosRedirectUri } from "@/lib/workos-redirect";

function workosConfigured(): boolean {
  return Boolean(
    trim(process.env.WORKOS_CLIENT_ID)
      && trim(process.env.WORKOS_API_KEY)
      && trim(process.env.WORKOS_COOKIE_PASSWORD),
  );
}

function trim(value: string | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}

const resolvedWorkosRedirectUri = resolveWorkosRedirectUri();

if (!trim(process.env.WORKOS_REDIRECT_URI) && resolvedWorkosRedirectUri) {
  process.env.WORKOS_REDIRECT_URI = resolvedWorkosRedirectUri;
}

export const startInstance = createStart(() => ({
  requestMiddleware: workosConfigured()
    ? [
      authkitMiddleware({
        redirectUri: resolvedWorkosRedirectUri,
      }),
    ]
    : [],
}));
