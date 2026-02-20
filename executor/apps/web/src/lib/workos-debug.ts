function trim(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && candidate.length > 0 ? candidate : undefined;
}

const WORKOS_DEBUG_VALUES = new Set(["1", "true", "yes", "on"]);

function isWorkosDebugEnabledInternal(): boolean {
  if (process.env.NODE_ENV !== "production") {
    return true;
  }

  const value = trim(process.env.WORKOS_DEBUG_AUTH);
  return value ? WORKOS_DEBUG_VALUES.has(value.toLowerCase()) : false;
}

export function isWorkosDebugEnabled(): boolean {
  return isWorkosDebugEnabledInternal();
}

export function redactAuthCode(value: string | null | undefined): string {
  const code = trim(value);
  if (!code) {
    return "missing";
  }
  if (code.length <= 10) {
    return "*".repeat(code.length);
  }

  return `${code.slice(0, 4)}...${code.slice(-4)}`;
}

export function logWorkosAuth(message: string, details: Record<string, unknown>): void {
  if (!isWorkosDebugEnabledInternal()) {
    return;
  }

  console.info(`[workos] ${message}: ${JSON.stringify(details)}`);
}
