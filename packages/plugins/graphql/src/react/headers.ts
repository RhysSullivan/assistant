import {
  newKeyValueEntry,
  type KeyValueEntry,
} from "@executor/react/plugins/key-value-list";
import type { AuthMode } from "@executor/react/plugins/source-config";

import type { HeaderValue } from "../sdk/types";

export interface ParsedAuth {
  readonly mode: AuthMode;
  readonly bearerSecretId: string | null;
  readonly otherHeaders: KeyValueEntry[];
}

export function parseAuthFromHeaders(
  all: Readonly<Record<string, HeaderValue>>,
): ParsedAuth {
  const authHeader = all["Authorization"];
  if (
    authHeader &&
    typeof authHeader !== "string" &&
    authHeader.prefix === "Bearer "
  ) {
    const rest = { ...all };
    delete rest["Authorization"];
    return {
      mode: "bearer",
      bearerSecretId: authHeader.secretId,
      otherHeaders: toEntries(rest),
    };
  }
  return { mode: "none", bearerSecretId: null, otherHeaders: toEntries(all) };
}

export function headersFromAuth(
  bearerSecretId: string | null,
  entries: readonly KeyValueEntry[],
): Record<string, HeaderValue> {
  const result: Record<string, HeaderValue> = {};
  if (bearerSecretId) {
    result["Authorization"] = { secretId: bearerSecretId, prefix: "Bearer " };
  }
  for (const entry of entries) {
    const name = entry.key.trim();
    if (!name || !entry.value) continue;
    if (entry.type === "secret") {
      result[name] = { secretId: entry.value };
    } else {
      result[name] = entry.value;
    }
  }
  return result;
}

function toEntries(
  headers: Readonly<Record<string, HeaderValue>>,
): KeyValueEntry[] {
  return Object.entries(headers).map(([name, value]) => {
    if (typeof value === "string") {
      return newKeyValueEntry({ key: name, value, type: "text" });
    }
    return newKeyValueEntry({ key: name, value: value.secretId, type: "secret" });
  });
}
