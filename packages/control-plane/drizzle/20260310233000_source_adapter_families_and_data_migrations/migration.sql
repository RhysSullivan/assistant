ALTER TABLE "source_recipes"
DROP CONSTRAINT IF EXISTS "source_recipes_kind_check";--> statement-breakpoint

UPDATE "source_recipes"
SET "kind" = 'http_api'
WHERE "kind" IN ('http_recipe', 'graphql_recipe');--> statement-breakpoint

UPDATE "source_recipes"
SET "kind" = 'mcp'
WHERE "kind" = 'mcp_recipe';--> statement-breakpoint

UPDATE "source_recipes"
SET "kind" = 'internal'
WHERE "kind" = 'internal_recipe';--> statement-breakpoint

ALTER TABLE "source_recipes"
ADD CONSTRAINT "source_recipes_kind_check"
CHECK ("kind" in ('http_api', 'mcp', 'internal'));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "control_plane_data_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "applied_at" bigint NOT NULL
);
