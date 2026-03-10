CREATE TABLE "source_recipe_schema_bundles" (
	"id" text PRIMARY KEY NOT NULL,
	"recipe_revision_id" text NOT NULL,
	"bundle_kind" text NOT NULL,
	"refs_json" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "source_recipe_schema_bundles_kind_check" CHECK ("source_recipe_schema_bundles"."bundle_kind" in ('json_schema_ref_map'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "source_recipe_schema_bundles_revision_kind_idx" ON "source_recipe_schema_bundles" USING btree ("recipe_revision_id","bundle_kind");
--> statement-breakpoint
CREATE INDEX "source_recipe_schema_bundles_revision_created_idx" ON "source_recipe_schema_bundles" USING btree ("recipe_revision_id","created_at","id");
