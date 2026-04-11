ALTER TABLE "sources" RENAME COLUMN "organization_id" TO "scope_id";
--> statement-breakpoint
ALTER TABLE "tools" RENAME COLUMN "organization_id" TO "scope_id";
--> statement-breakpoint
ALTER TABLE "tool_definitions" RENAME COLUMN "organization_id" TO "scope_id";
--> statement-breakpoint
ALTER TABLE "secrets" RENAME COLUMN "organization_id" TO "scope_id";
--> statement-breakpoint
ALTER TABLE "policies" RENAME COLUMN "organization_id" TO "scope_id";
--> statement-breakpoint
ALTER TABLE "plugin_kv" RENAME COLUMN "organization_id" TO "scope_id";
