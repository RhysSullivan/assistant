-- Normalize mcp plugin: lift the McpConnectionAuth secret/connection
-- refs and the SecretBackedMap headers/query_params out of
-- mcp_source.config JSON into proper columns / child tables. pg port
-- of apps/local/drizzle/0009_normalize_mcp.sql.

CREATE TABLE "mcp_source_header" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text_value" text,
	"secret_id" text,
	"secret_prefix" text,
	CONSTRAINT "mcp_source_header_scope_id_id_pk" PRIMARY KEY("scope_id","id")
);
--> statement-breakpoint
CREATE INDEX "mcp_source_header_scope_id_idx" ON "mcp_source_header" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "mcp_source_header_source_id_idx" ON "mcp_source_header" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "mcp_source_header_secret_id_idx" ON "mcp_source_header" USING btree ("secret_id");--> statement-breakpoint

CREATE TABLE "mcp_source_query_param" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text_value" text,
	"secret_id" text,
	"secret_prefix" text,
	CONSTRAINT "mcp_source_query_param_scope_id_id_pk" PRIMARY KEY("scope_id","id")
);
--> statement-breakpoint
CREATE INDEX "mcp_source_query_param_scope_id_idx" ON "mcp_source_query_param" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "mcp_source_query_param_source_id_idx" ON "mcp_source_query_param" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "mcp_source_query_param_secret_id_idx" ON "mcp_source_query_param" USING btree ("secret_id");--> statement-breakpoint

ALTER TABLE "mcp_source" ADD COLUMN "auth_kind" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_source" ADD COLUMN "auth_header_name" text;--> statement-breakpoint
ALTER TABLE "mcp_source" ADD COLUMN "auth_secret_id" text;--> statement-breakpoint
ALTER TABLE "mcp_source" ADD COLUMN "auth_secret_prefix" text;--> statement-breakpoint
ALTER TABLE "mcp_source" ADD COLUMN "auth_connection_id" text;--> statement-breakpoint
ALTER TABLE "mcp_source" ADD COLUMN "auth_client_id_secret_id" text;--> statement-breakpoint
ALTER TABLE "mcp_source" ADD COLUMN "auth_client_secret_secret_id" text;--> statement-breakpoint
CREATE INDEX "mcp_source_auth_secret_id_idx" ON "mcp_source" USING btree ("auth_secret_id");--> statement-breakpoint
CREATE INDEX "mcp_source_auth_connection_id_idx" ON "mcp_source" USING btree ("auth_connection_id");--> statement-breakpoint
CREATE INDEX "mcp_source_auth_client_id_secret_id_idx" ON "mcp_source" USING btree ("auth_client_id_secret_id");--> statement-breakpoint
CREATE INDEX "mcp_source_auth_client_secret_secret_id_idx" ON "mcp_source" USING btree ("auth_client_secret_secret_id");--> statement-breakpoint

-- Only update rows with explicitly current-shape auth (kind=header w/
-- secretId, or kind=oauth2 w/ connectionId). Legacy inline-OAuth rows
-- are left untouched so the post-migrate migrateLegacyConnections
-- script can convert them to a Connection.
UPDATE "mcp_source"
SET
	"auth_kind" = "config"#>>'{auth,kind}',
	"auth_header_name" = "config"#>>'{auth,headerName}',
	"auth_secret_id" = "config"#>>'{auth,secretId}',
	"auth_secret_prefix" = "config"#>>'{auth,prefix}',
	"auth_connection_id" = "config"#>>'{auth,connectionId}',
	"auth_client_id_secret_id" = "config"#>>'{auth,clientIdSecretId}',
	"auth_client_secret_secret_id" = "config"#>>'{auth,clientSecretSecretId}'
WHERE "config" IS NOT NULL
  AND (
    (
      "config"#>>'{auth,kind}' = 'header'
      AND "config"#>>'{auth,secretId}' IS NOT NULL
    )
    OR (
      "config"#>>'{auth,kind}' = 'oauth2'
      AND "config"#>>'{auth,connectionId}' IS NOT NULL
    )
  );--> statement-breakpoint

INSERT INTO "mcp_source_header"
	("scope_id", "id", "source_id", "name", "kind", "text_value", "secret_id", "secret_prefix")
SELECT
	s."scope_id",
	'[' || to_jsonb(s."id")::text || ',' || to_jsonb(h.key)::text || ']',
	s."id",
	h.key,
	CASE
		WHEN jsonb_typeof(h.value) = 'object' AND h.value ? 'secretId' THEN 'secret'
		ELSE 'text'
	END,
	CASE WHEN jsonb_typeof(h.value) = 'string' THEN h.value #>> '{}' ELSE NULL END,
	CASE WHEN jsonb_typeof(h.value) = 'object' THEN h.value->>'secretId' ELSE NULL END,
	CASE WHEN jsonb_typeof(h.value) = 'object' THEN h.value->>'prefix' ELSE NULL END
FROM "mcp_source" s, jsonb_each(s."config"->'headers') h
WHERE s."config"->'headers' IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "mcp_source_query_param"
	("scope_id", "id", "source_id", "name", "kind", "text_value", "secret_id", "secret_prefix")
SELECT
	s."scope_id",
	'[' || to_jsonb(s."id")::text || ',' || to_jsonb(q.key)::text || ']',
	s."id",
	q.key,
	CASE
		WHEN jsonb_typeof(q.value) = 'object' AND q.value ? 'secretId' THEN 'secret'
		ELSE 'text'
	END,
	CASE WHEN jsonb_typeof(q.value) = 'string' THEN q.value #>> '{}' ELSE NULL END,
	CASE WHEN jsonb_typeof(q.value) = 'object' THEN q.value->>'secretId' ELSE NULL END,
	CASE WHEN jsonb_typeof(q.value) = 'object' THEN q.value->>'prefix' ELSE NULL END
FROM "mcp_source" s, jsonb_each(s."config"->'queryParams') q
WHERE s."config"->'queryParams' IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Strip already-copied fields from config JSON. headers/queryParams
-- are always safe; auth is only stripped on rows whose auth was the
-- current shape (legacy inline-OAuth rows keep config.auth so
-- migrateLegacyConnections can mint a Connection from it).
UPDATE "mcp_source"
SET "config" = "config" - 'headers' - 'queryParams'
WHERE "config" IS NOT NULL;--> statement-breakpoint

UPDATE "mcp_source"
SET "config" = "config" - 'auth'
WHERE "config" IS NOT NULL
  AND (
    "config"#>>'{auth,kind}' = 'none'
    OR (
      "config"#>>'{auth,kind}' = 'header'
      AND "config"#>>'{auth,secretId}' IS NOT NULL
    )
    OR (
      "config"#>>'{auth,kind}' = 'oauth2'
      AND "config"#>>'{auth,connectionId}' IS NOT NULL
    )
  );
