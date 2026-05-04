// ---------------------------------------------------------------------------
// Workspace storage — local Drizzle-backed CRUD
// ---------------------------------------------------------------------------
//
// Workspaces are an org-local entity. Org membership grants access to every
// workspace in the org (no per-workspace ACLs in v1), and workspace deletion
// is intentionally out of scope. The store exposes only the surface the API
// + UI need today: create, list, get-by-slug, get-by-id.

import { and, asc, desc, eq, like } from "drizzle-orm";

import { newId, slugifyHandle, withHandleSuffix } from "./ids";
import { workspaces } from "./schema";
import type { DrizzleDb } from "./db";

export type Workspace = typeof workspaces.$inferSelect;

const SLUG_MAX_ATTEMPTS = 100;

const pickFreeSlug = async (
  db: DrizzleDb,
  organizationId: string,
  base: string,
): Promise<string> => {
  const existing = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.organizationId, organizationId),
        like(workspaces.slug, `${base}%`),
      ),
    );
  const taken = new Set(existing.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < SLUG_MAX_ATTEMPTS; n++) {
    const candidate = withHandleSuffix(base, n);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(
    `could not allocate workspace slug for org ${organizationId} (base "${base}")`,
  );
};

export const makeWorkspaceStore = (db: DrizzleDb) => ({
  /**
   * Create a workspace inside an org. Slug is auto-generated from `name`
   * with collision suffixes; caller can override by passing `slug` explicitly.
   */
  create: async (input: {
    organizationId: string;
    name: string;
    slug?: string;
  }): Promise<Workspace> => {
    const base = input.slug ?? slugifyHandle(input.name);
    const slug = await pickFreeSlug(db, input.organizationId, base);
    const [row] = await db
      .insert(workspaces)
      .values({
        id: newId("workspace"),
        organizationId: input.organizationId,
        slug,
        name: input.name,
      })
      .returning();
    return row!;
  },

  list: async (organizationId: string): Promise<Workspace[]> =>
    db
      .select()
      .from(workspaces)
      .where(eq(workspaces.organizationId, organizationId))
      .orderBy(asc(workspaces.createdAt)),

  getBySlug: async (
    organizationId: string,
    slug: string,
  ): Promise<Workspace | null> => {
    const rows = await db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.organizationId, organizationId),
          eq(workspaces.slug, slug),
        ),
      );
    return rows[0] ?? null;
  },

  getById: async (id: string): Promise<Workspace | null> => {
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, id));
    return rows[0] ?? null;
  },

  /** Most-recently-created first. Used by the switcher to suggest defaults. */
  listMostRecent: async (
    organizationId: string,
    limit = 50,
  ): Promise<Workspace[]> =>
    db
      .select()
      .from(workspaces)
      .where(eq(workspaces.organizationId, organizationId))
      .orderBy(desc(workspaces.createdAt))
      .limit(limit),
});

export type WorkspaceStore = ReturnType<typeof makeWorkspaceStore>;
