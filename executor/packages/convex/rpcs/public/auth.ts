import { mutation } from "../../_generated/server";
import { bootstrapCurrentWorkosAccountImpl } from "../../auth/bootstrap";

export const bootstrapCurrentWorkosAccount = mutation({
  args: {},
  handler: bootstrapCurrentWorkosAccountImpl,
});
