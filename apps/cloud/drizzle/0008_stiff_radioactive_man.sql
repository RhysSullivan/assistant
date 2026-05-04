CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_organization_slug_unique" ON "workspaces" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "workspaces_organization_id_idx" ON "workspaces" USING btree ("organization_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- organizations.handle: add nullable, backfill from name with collision
-- suffixes, then enforce NOT NULL + UNIQUE. Cloud has few users so a single
-- migration backfill is acceptable; matches `slugifyHandle` in
-- apps/cloud/src/services/ids.ts (kept simple — diacritic folding is best
-- effort for ASCII names).
-- ---------------------------------------------------------------------------
ALTER TABLE "organizations" ADD COLUMN "handle" text;--> statement-breakpoint
WITH normalized AS (
	SELECT
		"id",
		"created_at",
		COALESCE(
			NULLIF(
				regexp_replace(
					regexp_replace(
						regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g'),
						'-+', '-', 'g'
					),
					'^-|-$', '', 'g'
				),
				''
			),
			'org'
		) AS base
	FROM "organizations"
), ranked AS (
	SELECT
		"id",
		"base",
		row_number() OVER (PARTITION BY "base" ORDER BY "created_at", "id") AS rn
	FROM normalized
)
UPDATE "organizations" o
SET "handle" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || (r.rn - 1) END
FROM ranked r
WHERE r."id" = o."id";
--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "handle" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_handle_unique" UNIQUE("handle");
