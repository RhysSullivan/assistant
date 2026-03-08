DROP INDEX IF EXISTS "organization_memberships_org_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "organization_memberships_account_idx";--> statement-breakpoint
CREATE INDEX "organization_memberships_org_updated_idx" ON "organization_memberships" ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "organization_memberships_account_updated_idx" ON "organization_memberships" ("account_id","updated_at","id");--> statement-breakpoint
DROP INDEX IF EXISTS "workspaces_org_idx";--> statement-breakpoint
CREATE INDEX "workspaces_org_updated_idx" ON "workspaces" ("organization_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "sources_workspace_updated_idx" ON "sources" ("workspace_id","updated_at","source_id");--> statement-breakpoint
CREATE INDEX "tool_artifacts_search_text_idx" ON "tool_artifacts" USING gin (to_tsvector('simple', "search_text"));--> statement-breakpoint
DROP INDEX IF EXISTS "tool_artifact_parameters_lookup_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "tool_artifact_request_body_content_types_lookup_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "tool_artifact_ref_hint_keys_lookup_idx";--> statement-breakpoint
CREATE INDEX "source_auth_sessions_pending_idx" ON "source_auth_sessions" ("workspace_id","source_id","status","updated_at","id");--> statement-breakpoint
DROP INDEX IF EXISTS "policies_workspace_idx";--> statement-breakpoint
CREATE INDEX "policies_workspace_priority_idx" ON "policies" ("workspace_id","priority" DESC,"updated_at","id");--> statement-breakpoint
CREATE INDEX "local_installations_organization_idx" ON "local_installations" ("organization_id");--> statement-breakpoint
CREATE INDEX "local_installations_workspace_idx" ON "local_installations" ("workspace_id");
