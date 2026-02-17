"use node";

import { createWorkosClient, withWorkosVaultRetryResult } from "../../../core/src/credentials/workos-vault";

export async function readVaultObjectHandler(args: {
  objectId: string;
  apiKey?: string;
}): Promise<string> {
  const objectId = args.objectId.trim();
  if (!objectId) {
    throw new Error("WorkOS Vault object id is required");
  }

  const workosResult = createWorkosClient(args.apiKey);
  if (workosResult.isErr()) {
    throw new Error("WorkOS Vault provider requires WORKOS_API_KEY");
  }

  const readResult = await withWorkosVaultRetryResult(async () => {
    return await workosResult.value.vault.readObject({ id: objectId });
  });
  if (readResult.isErr()) {
    throw readResult.error;
  }

  const value = typeof readResult.value.value === "string" ? readResult.value.value : "";
  if (!value.trim()) {
    throw new Error(`WorkOS Vault object '${objectId}' returned an empty value`);
  }

  return value;
}
