// ---------------------------------------------------------------------------
// Cloud-specific identity & multi-tenancy tables
// ---------------------------------------------------------------------------
//
// AuthKit owns the canonical user/membership data. We mirror minimally:
//
//   - `accounts`       — login identity (foreign key anchor for created_by, etc.)
//   - `organizations`  — billing entity, scoping root for all domain data
//   - `memberships`    — which accounts belong to which organizations
//   - `workspaces`     — optional project context inside an org
//
// We do NOT mirror invitations or user profile data — those stay in WorkOS
// and are queried via API when needed.

import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Login identity. The `id` is the WorkOS user ID. */
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Organization (billing entity, scoping root). The `id` is the WorkOS
 * organization ID. `handle` is a local URL handle, generated from `name` on
 * create with collision suffixes; we keep it editable later without changing
 * the underlying WorkOS id.
 */
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Account ↔ organization link. Lets us answer "which workspaces does this
 * account belong to?" without a WorkOS round-trip, and gives future
 * per-(account, organization) data a foreign key to point at.
 */
export const memberships = pgTable(
  "memberships",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountId, t.organizationId] }),
  }),
);

/**
 * Workspace — narrower project context inside an organization. Org members
 * have access to every workspace in v1; per-workspace membership/roles are
 * out of scope. `slug` is unique within the org and used as the URL segment;
 * `id` is the immutable primary key (`workspace_<base58>`).
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex("workspaces_organization_slug_unique").on(
      t.organizationId,
      t.slug,
    ),
    orgIdx: index("workspaces_organization_id_idx").on(t.organizationId),
  }),
);
