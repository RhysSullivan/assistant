import { internalMutation } from "../../_generated/server";
import { authKitEvents } from "../../auth/authKit";

export const authKitEvent = authKitEvents?.authKitEvent ?? internalMutation({
  args: {},
  handler: async () => null,
});
