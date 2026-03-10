ALTER TABLE "sources" DROP CONSTRAINT IF EXISTS "sources_kind_check";
--> statement-breakpoint
ALTER TABLE "source_recipes" DROP CONSTRAINT IF EXISTS "source_recipes_importer_kind_check";
--> statement-breakpoint
ALTER TABLE "source_recipe_documents" DROP CONSTRAINT IF EXISTS "source_recipe_documents_kind_check";
--> statement-breakpoint
ALTER TABLE "source_recipe_schema_bundles" DROP CONSTRAINT IF EXISTS "source_recipe_schema_bundles_kind_check";
--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP CONSTRAINT IF EXISTS "source_recipe_operations_provider_kind_check";
