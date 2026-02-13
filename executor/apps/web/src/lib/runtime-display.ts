import type { RuntimeTargetDescriptor } from "@/lib/types";

const RUNTIME_LABEL_OVERRIDES: Record<string, string> = {
  "local-bun": "Local Runtime",
  "cloudflare-worker-loader": "Managed Runtime",
};

const CLOUD_RUNTIME_LABEL_PATTERN = /cloudflare.*worker.*loader/i;

function sanitizeRuntimeLabel(label: string): string {
  return CLOUD_RUNTIME_LABEL_PATTERN.test(label) ? "Managed Runtime" : label;
}

export function getTaskRuntimeLabel(
  runtimeId: string,
  runtimeTargets: RuntimeTargetDescriptor[] = [],
): string {
  if (RUNTIME_LABEL_OVERRIDES[runtimeId]) {
    return RUNTIME_LABEL_OVERRIDES[runtimeId];
  }

  const descriptor = runtimeTargets.find((runtime) => runtime.id === runtimeId);
  if (descriptor?.label) {
    return sanitizeRuntimeLabel(descriptor.label);
  }

  return runtimeId;
}
