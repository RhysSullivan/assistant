-- ---------------------------------------------------------------------------
-- One-shot migration: convert raw scope ids to deterministic prefixed form.
--
--   <orgId>                            ->  org_<orgId>
--   user-org:<userId>:<orgId>          ->  user_org_<userId>_<orgId>
--
-- Mirrors orgScopeId() / userOrgScopeId() in apps/cloud/src/services/ids.ts.
-- Run order: rewrite user-org rows first so they don't accidentally match
-- the org rewrite (a `user-org:` value will never be an organizations.id,
-- but keeping the rules independent of catalog state is cheaper than
-- proving it).
-- ---------------------------------------------------------------------------

-- user-org:U:O -> user_org_U_O across every scoped table.
UPDATE "source"                  SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "tool"                    SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "definition"              SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "secret"                  SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "connection"              SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "oauth2_session"          SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "tool_policy"             SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "openapi_source"          SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "openapi_operation"       SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "openapi_source_binding"  SET "source_scope_id" = 'user_org_' || replace(substring("source_scope_id" from 10), ':', '_') WHERE "source_scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "openapi_source_binding"  SET "target_scope_id" = 'user_org_' || replace(substring("target_scope_id" from 10), ':', '_') WHERE "target_scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "mcp_source"              SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "mcp_binding"             SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "graphql_source"          SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "graphql_operation"       SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint
UPDATE "workos_vault_metadata"   SET "scope_id" = 'user_org_' || replace(substring("scope_id" from 10), ':', '_') WHERE "scope_id" LIKE 'user-org:%';--> statement-breakpoint

-- raw <orgId> -> org_<orgId> for every scoped table.
UPDATE "source"                  SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "tool"                    SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "definition"              SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "secret"                  SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "connection"              SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "oauth2_session"          SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "tool_policy"             SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "openapi_source"          SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "openapi_operation"       SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "openapi_source_binding"  SET "source_scope_id" = 'org_' || "source_scope_id" WHERE "source_scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "openapi_source_binding"  SET "target_scope_id" = 'org_' || "target_scope_id" WHERE "target_scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "mcp_source"              SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "mcp_binding"             SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "graphql_source"          SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "graphql_operation"       SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");--> statement-breakpoint
UPDATE "workos_vault_metadata"   SET "scope_id" = 'org_' || "scope_id" WHERE "scope_id" IN (SELECT "id" FROM "organizations");
