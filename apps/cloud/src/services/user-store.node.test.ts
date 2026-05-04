// ---------------------------------------------------------------------------
// user-store handle picking + upsert behavior
// ---------------------------------------------------------------------------
//
// Validates the runtime org handle generator: stable across re-upserts (we
// don't change the handle on a name change), and resolves collisions by
// numeric suffix.

import { describe, expect, it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { combinedSchema } from "./db";
import { organizations } from "./schema";
import { makeUserStore, pickFreeOrgHandle } from "./user-store";

const url =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5434/postgres";

const withDb = async <T>(fn: (db: ReturnType<typeof drizzle>) => Promise<T>) => {
  const sql = postgres(url, { max: 1, idle_timeout: 0, max_lifetime: 30 });
  try {
    const db = drizzle(sql, { schema: combinedSchema });
    return await fn(db);
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
};

describe("user-store handles", () => {
  it("upsertOrganization assigns a slugified handle on first insert", async () => {
    const id = `org_${crypto.randomUUID()}`;
    const org = await withDb((db) =>
      makeUserStore(db).upsertOrganization({ id, name: "Acme Corp" }),
    );
    expect(org.handle.startsWith("acme-corp")).toBe(true);
  });

  it("upsertOrganization keeps the handle stable across name changes", async () => {
    const id = `org_${crypto.randomUUID()}`;
    const first = await withDb((db) =>
      makeUserStore(db).upsertOrganization({ id, name: "Stable Name" }),
    );
    const second = await withDb((db) =>
      makeUserStore(db).upsertOrganization({ id, name: "Renamed Org" }),
    );
    expect(second.handle).toBe(first.handle);
    expect(second.name).toBe("Renamed Org");
  });

  it("pickFreeOrgHandle resolves collisions with -2, -3, …", async () => {
    const base = `coll-${crypto.randomUUID().slice(0, 8)}`;
    await withDb(async (db) => {
      await db.insert(organizations).values({
        id: `org_${crypto.randomUUID()}`,
        name: "x",
        handle: base,
      });
      const next = await pickFreeOrgHandle(db, base);
      expect(next).toBe(`${base}-2`);
      await db.insert(organizations).values({
        id: `org_${crypto.randomUUID()}`,
        name: "y",
        handle: `${base}-2`,
      });
      const after = await pickFreeOrgHandle(db, base);
      expect(after).toBe(`${base}-3`);
    });
  });

  it("getOrganizationByHandle round-trips", async () => {
    const id = `org_${crypto.randomUUID()}`;
    const handle = `lookup-${crypto.randomUUID().slice(0, 8)}`;
    await withDb(async (db) => {
      await db
        .insert(organizations)
        .values({ id, name: "Lookup", handle });
      const fetched = await makeUserStore(db).getOrganizationByHandle(handle);
      expect(fetched?.id).toBe(id);
      const missing = await makeUserStore(db).getOrganizationByHandle(
        `nope-${crypto.randomUUID()}`,
      );
      expect(missing).toBeNull();
      // cleanup so other tests don't see leaked rows
      await db.delete(organizations).where(eq(organizations.id, id));
    });
  });
});
