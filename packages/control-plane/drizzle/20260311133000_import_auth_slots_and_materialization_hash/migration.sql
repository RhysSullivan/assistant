ALTER TABLE "sources" ADD COLUMN "import_auth_policy" text;--> statement-breakpoint

UPDATE "sources"
SET "import_auth_policy" = CASE
  WHEN "kind" = 'internal' THEN 'none'
  ELSE 'reuse_runtime'
END
WHERE "import_auth_policy" IS NULL;--> statement-breakpoint

ALTER TABLE "sources"
ALTER COLUMN "import_auth_policy" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "sources"
DROP CONSTRAINT IF EXISTS "sources_import_auth_policy_check";--> statement-breakpoint

ALTER TABLE "sources"
ADD CONSTRAINT "sources_import_auth_policy_check"
CHECK ("import_auth_policy" in ('none', 'reuse_runtime', 'separate'));--> statement-breakpoint

ALTER TABLE "source_recipe_revisions" ADD COLUMN "materialization_hash" text;--> statement-breakpoint

UPDATE "source_recipe_revisions"
SET "materialization_hash" = "manifest_hash"
WHERE "materialization_hash" IS NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "source_recipe_revisions_recipe_manifest_idx";--> statement-breakpoint

CREATE UNIQUE INDEX "source_recipe_revisions_recipe_materialization_idx"
ON "source_recipe_revisions" ("recipe_id","materialization_hash");--> statement-breakpoint

CREATE INDEX "source_recipe_revisions_recipe_manifest_idx"
ON "source_recipe_revisions" ("recipe_id","manifest_hash");--> statement-breakpoint

ALTER TABLE "workspace_source_credentials" ADD COLUMN "slot" text;--> statement-breakpoint

UPDATE "workspace_source_credentials"
SET "slot" = 'runtime'
WHERE "slot" IS NULL;--> statement-breakpoint

ALTER TABLE "workspace_source_credentials"
ALTER COLUMN "slot" SET NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "credentials_workspace_source_actor_idx";--> statement-breakpoint

ALTER TABLE "workspace_source_credentials"
DROP CONSTRAINT IF EXISTS "credentials_slot_check";--> statement-breakpoint

ALTER TABLE "workspace_source_credentials"
ADD CONSTRAINT "credentials_slot_check"
CHECK ("slot" in ('runtime', 'import'));--> statement-breakpoint

CREATE UNIQUE INDEX "credentials_workspace_source_actor_idx"
ON "workspace_source_credentials" ("workspace_id","source_id","actor_account_id","slot");--> statement-breakpoint

ALTER TABLE "source_auth_sessions" ADD COLUMN "credential_slot" text;--> statement-breakpoint

UPDATE "source_auth_sessions"
SET "credential_slot" = 'runtime'
WHERE "credential_slot" IS NULL;--> statement-breakpoint

ALTER TABLE "source_auth_sessions"
ALTER COLUMN "credential_slot" SET NOT NULL;--> statement-breakpoint

DROP INDEX IF EXISTS "source_auth_sessions_pending_idx";--> statement-breakpoint

ALTER TABLE "source_auth_sessions"
DROP CONSTRAINT IF EXISTS "source_auth_sessions_credential_slot_check";--> statement-breakpoint

ALTER TABLE "source_auth_sessions"
ADD CONSTRAINT "source_auth_sessions_credential_slot_check"
CHECK ("credential_slot" in ('runtime', 'import'));--> statement-breakpoint

CREATE INDEX "source_auth_sessions_pending_idx"
ON "source_auth_sessions" (
  "workspace_id",
  "source_id",
  "actor_account_id",
  "credential_slot",
  "status",
  "updated_at",
  "id"
);--> statement-breakpoint
