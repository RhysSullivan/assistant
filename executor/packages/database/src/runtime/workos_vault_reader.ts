import { internal } from "../../convex/_generated/api";
import type { ActionCtx } from "../../convex/_generated/server";
import type { VaultReadInput } from "../../../core/src/credential-providers";

export async function readWorkosVaultObjectViaAction(
  ctx: Pick<ActionCtx, "runAction">,
  input: VaultReadInput,
): Promise<string> {
  return await ctx.runAction(internal.runtimeNode.readVaultObject, {
    objectId: input.objectId,
    apiKey: input.apiKey,
  });
}
