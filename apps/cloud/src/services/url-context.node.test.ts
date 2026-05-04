// URL-context resolver tests against the live test database.

import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { DbService, combinedSchema } from "./db";
import { organizations } from "./schema";
import { makeUserStore } from "./user-store";
import { makeWorkspaceStore } from "./workspace-store";
import {
  resolveOrgContext,
  resolveWorkspaceContext,
} from "./url-context";

const url =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5434/postgres";

const program = <A, E>(body: Effect.Effect<A, E, DbService>) =>
  Effect.runPromise(
    body.pipe(Effect.provide(DbService.Live), Effect.scoped) as Effect.Effect<
      A,
      E,
      never
    >,
  );

const seedOrgWithHandle = async (handle: string, name = handle) => {
  const orgId = `org_${crypto.randomUUID()}`;
  const sql = postgres(url, { max: 1, idle_timeout: 0, max_lifetime: 30 });
  try {
    const db = drizzle(sql, { schema: combinedSchema });
    await makeUserStore(db).upsertOrganization({ id: orgId, name });
    // Force the handle to a known value (upsertOrganization picks one
    // from the name; tests want determinism).
    await db
      .update(organizations)
      .set({ handle })
      .where(eq(organizations.id, orgId));
  } finally {
    await sql.end({ timeout: 0 }).catch(() => undefined);
  }
  return { orgId, handle };
};

describe("resolveOrgContext", () => {
  it("resolves a known handle to the org row", async () => {
    const handle = `acme-${crypto.randomUUID().slice(0, 8)}`;
    const { orgId } = await seedOrgWithHandle(handle, "Acme");
    const result = await program(resolveOrgContext(handle));
    expect(result.organization.id).toBe(orgId);
    expect(result.organization.handle).toBe(handle);
  });

  it("fails with OrganizationHandleNotFound for unknown handles", async () => {
    const handle = `nope-${crypto.randomUUID().slice(0, 8)}`;
    const exit = await Effect.runPromiseExit(
      resolveOrgContext(handle).pipe(
        Effect.provide(DbService.Live),
        Effect.scoped,
      ) as Effect.Effect<unknown, unknown, never>,
    );
    expect(exit._tag).toBe("Failure");
    const errors =
      exit._tag === "Failure" ? JSON.stringify(exit.cause) : "";
    expect(errors).toContain("OrganizationHandleNotFound");
  });
});

describe("resolveWorkspaceContext", () => {
  it("resolves a known org+slug pair to org and workspace rows", async () => {
    const handle = `acme-${crypto.randomUUID().slice(0, 8)}`;
    const { orgId } = await seedOrgWithHandle(handle, "Acme");
    const sql = postgres(url, { max: 1, idle_timeout: 0, max_lifetime: 30 });
    let wsSlug: string;
    let wsId: string;
    try {
      const db = drizzle(sql, { schema: combinedSchema });
      const ws = await makeWorkspaceStore(db).create({
        organizationId: orgId,
        name: "Billing API",
      });
      wsSlug = ws.slug;
      wsId = ws.id;
    } finally {
      await sql.end({ timeout: 0 }).catch(() => undefined);
    }
    const result = await program(resolveWorkspaceContext(handle, wsSlug));
    expect(result.organization.id).toBe(orgId);
    expect(result.workspace.id).toBe(wsId);
  });

  it("fails when the slug exists in a different org", async () => {
    const aHandle = `org-a-${crypto.randomUUID().slice(0, 8)}`;
    const bHandle = `org-b-${crypto.randomUUID().slice(0, 8)}`;
    const { orgId: orgA } = await seedOrgWithHandle(aHandle);
    await seedOrgWithHandle(bHandle);
    const sql = postgres(url, { max: 1, idle_timeout: 0, max_lifetime: 30 });
    let wsSlug: string;
    try {
      const db = drizzle(sql, { schema: combinedSchema });
      const ws = await makeWorkspaceStore(db).create({
        organizationId: orgA,
        name: "Shared",
      });
      wsSlug = ws.slug;
    } finally {
      await sql.end({ timeout: 0 }).catch(() => undefined);
    }
    const exit = await Effect.runPromiseExit(
      resolveWorkspaceContext(bHandle, wsSlug).pipe(
        Effect.provide(DbService.Live),
        Effect.scoped,
      ) as Effect.Effect<unknown, unknown, never>,
    );
    expect(exit._tag).toBe("Failure");
    const errors =
      exit._tag === "Failure" ? JSON.stringify(exit.cause) : "";
    expect(errors).toContain("WorkspaceSlugNotFound");
  });
});
