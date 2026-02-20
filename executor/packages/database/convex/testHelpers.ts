import type { TestConvex } from "convex-test";
import { defineSchema } from "convex/server";
import type { GenericSchema, SchemaDefinition } from "convex/server";

const rateLimiterSchema = defineSchema({});

const rateLimiterModules = {
  "./lib.ts": () => import("../src/testing/rate_limiter_component"),
  "./_generated/api.js": () => import("./_generated/api.js"),
};

export function registerRateLimiterComponent(t: TestConvex<SchemaDefinition<GenericSchema, boolean>>): void {
  t.registerComponent("rateLimiter", rateLimiterSchema, rateLimiterModules);
}
