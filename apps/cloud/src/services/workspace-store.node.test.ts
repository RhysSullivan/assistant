// Workspace store + handle-derivation tests.

import { describe, expect, it } from "@effect/vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { combinedSchema } from "./db";
import { organizations } from "./schema";
import { makeWorkspaceStore } from "./workspace-store";
import { makeUserStore } from "./user-store";

const url =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5434/postgres";

const withDb = async <T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>) => {
  const sql = postgres(url, { max: 1, idle_timeout: 0, max_lifetime: 30 });
  try {
    return await fn(drizzle(sql, { schema: combinedSchema }));
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
};

const seedOrg = async (db: ReturnType<typeof drizzle>) => {
  const id = `org_${crypto.randomUUID()}`;
  await makeUserStore(db).upsertOrganization({ id, name: `Test ${id}` });
  return id;
};

describe("workspace-store", () => {
  it("creates a workspace with slugified id and slug from name", async () => {
    await withDb(async (db) => {
      const orgId = await seedOrg(db);
      const ws = await makeWorkspaceStore(db).create({
        organizationId: orgId,
        name: "Billing API",
      });
      expect(ws.organizationId).toBe(orgId);
      expect(ws.slug).toBe("billing-api");
      expect(ws.id.startsWith("workspace_")).toBe(true);
      expect(ws.name).toBe("Billing API");
    });
  });

  it("disambiguates slug collisions within an org with -2, -3, …", async () => {
    await withDb(async (db) => {
      const orgId = await seedOrg(db);
      const store = makeWorkspaceStore(db);
      const a = await store.create({ organizationId: orgId, name: "Edge Cases" });
      const b = await store.create({ organizationId: orgId, name: "Edge cases" });
      const c = await store.create({ organizationId: orgId, name: "EDGE-cases" });
      expect(a.slug).toBe("edge-cases");
      expect(b.slug).toBe("edge-cases-2");
      expect(c.slug).toBe("edge-cases-3");
    });
  });

  it("allows the same slug across different orgs", async () => {
    await withDb(async (db) => {
      const o1 = await seedOrg(db);
      const o2 = await seedOrg(db);
      const a = await makeWorkspaceStore(db).create({
        organizationId: o1,
        name: "Common",
      });
      const b = await makeWorkspaceStore(db).create({
        organizationId: o2,
        name: "Common",
      });
      expect(a.slug).toBe("common");
      expect(b.slug).toBe("common");
    });
  });

  it("respects an explicit slug override", async () => {
    await withDb(async (db) => {
      const orgId = await seedOrg(db);
      const ws = await makeWorkspaceStore(db).create({
        organizationId: orgId,
        name: "Anything",
        slug: "custom-handle",
      });
      expect(ws.slug).toBe("custom-handle");
    });
  });

  it("list returns workspaces in creation order", async () => {
    await withDb(async (db) => {
      const orgId = await seedOrg(db);
      const store = makeWorkspaceStore(db);
      await store.create({ organizationId: orgId, name: "First" });
      await store.create({ organizationId: orgId, name: "Second" });
      const rows = await store.list(orgId);
      expect(rows.map((r) => r.slug)).toEqual(["first", "second"]);
    });
  });

  it("getBySlug returns null for an unknown slug", async () => {
    await withDb(async (db) => {
      const orgId = await seedOrg(db);
      const missing = await makeWorkspaceStore(db).getBySlug(orgId, "nope");
      expect(missing).toBeNull();
    });
  });

  it("getBySlug scopes to the org", async () => {
    await withDb(async (db) => {
      const o1 = await seedOrg(db);
      const o2 = await seedOrg(db);
      const a = await makeWorkspaceStore(db).create({
        organizationId: o1,
        name: "Shared",
      });
      const fromO2 = await makeWorkspaceStore(db).getBySlug(o2, a.slug);
      expect(fromO2).toBeNull();
      const fromO1 = await makeWorkspaceStore(db).getBySlug(o1, a.slug);
      expect(fromO1?.id).toBe(a.id);
    });
  });
});
