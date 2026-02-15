import { expect, test, describe } from "bun:test";
import { convexTest } from "convex-test";

import { internal } from "./_generated/api";
import schema from "./schema";

function setup() {
  return convexTest(schema, {
    "./workspaceToolCache.ts": () => import("./workspaceToolCache"),
    "./_generated/api.js": () => import("./_generated/api.js"),
  });
}

describe("workspaceToolCache table operations", () => {
  test("getEntry + putEntry round-trip", async () => {
    const t = setup();

    const wsId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "test-org",
        slug: "test-org",
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("workspaces", {
        name: "test-ws",
        slug: "test-ws",
        organizationId: orgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    // Empty cache
    const miss = await t.query(internal.workspaceToolCache.getEntry, {
      workspaceId: wsId,
      signature: "sig_1",
    });
    expect(miss).toBeNull();

    // Store
    const storageId = await t.run(async (ctx) => {
      const blob = new Blob(['{"tools":[],"warnings":[]}'], { type: "application/json" });
      return await ctx.storage.store(blob);
    });

    await t.mutation(internal.workspaceToolCache.putEntry, {
      workspaceId: wsId,
      signature: "sig_1",
      storageId,
      toolCount: 0,
      sizeBytes: 27,
    });

    // Hit
    const hit = await t.query(internal.workspaceToolCache.getEntry, {
      workspaceId: wsId,
      signature: "sig_1",
    });
    expect(hit).not.toBeNull();
    expect(hit!.storageId).toBe(storageId);
    expect(hit!.isFresh).toBe(true);

    // Wrong signature = stale entry
    const wrongSig = await t.query(internal.workspaceToolCache.getEntry, {
      workspaceId: wsId,
      signature: "sig_2",
    });
    expect(wrongSig).not.toBeNull();
    expect(wrongSig!.isFresh).toBe(false);
    expect(wrongSig!.storageId).toBe(storageId);
  });

  test("putEntry replaces old entry and deletes old blob", async () => {
    const t = setup();

    const wsId = await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", {
        name: "test-org",
        slug: "test-org",
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return await ctx.db.insert("workspaces", {
        name: "test-ws",
        slug: "test-ws",
        organizationId: orgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const storageId1 = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["old"]));
    });

    await t.mutation(internal.workspaceToolCache.putEntry, {
      workspaceId: wsId,
      signature: "sig_1",
      storageId: storageId1,
      toolCount: 5,
      sizeBytes: 3,
    });

    const storageId2 = await t.run(async (ctx) => {
      return await ctx.storage.store(new Blob(["new"]));
    });

    await t.mutation(internal.workspaceToolCache.putEntry, {
      workspaceId: wsId,
      signature: "sig_2",
      storageId: storageId2,
      toolCount: 10,
      sizeBytes: 3,
    });

    // New entry
    const entry = await t.query(internal.workspaceToolCache.getEntry, {
      workspaceId: wsId,
      signature: "sig_2",
    });
    expect(entry!.storageId).toBe(storageId2);
    expect(entry!.toolCount).toBe(10);
    expect(entry!.isFresh).toBe(true);

    // Old blob deleted
    const oldBlob = await t.run(async (ctx) => ctx.storage.get(storageId1));
    expect(oldBlob).toBeNull();
  });
});
