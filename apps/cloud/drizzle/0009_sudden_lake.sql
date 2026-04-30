DROP TABLE "blob" CASCADE;--> statement-breakpoint
ALTER TABLE "graphql_source" ADD COLUMN "query_params" jsonb;--> statement-breakpoint
ALTER TABLE "openapi_source" ADD COLUMN "query_params" jsonb;--> statement-breakpoint
