-- Normalize graphql plugin: move secret/connection refs out of JSON
-- columns into proper relational shape so usagesForSecret /
-- usagesForConnection are one indexed SELECT instead of a JSON scan.
-- pg port of apps/local/drizzle/0007_normalize_graphql.sql.

CREATE TABLE "graphql_source_header" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text_value" text,
	"secret_id" text,
	"secret_prefix" text,
	CONSTRAINT "graphql_source_header_scope_id_id_pk" PRIMARY KEY("scope_id","id")
);
--> statement-breakpoint
CREATE INDEX "graphql_source_header_scope_id_idx" ON "graphql_source_header" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "graphql_source_header_source_id_idx" ON "graphql_source_header" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "graphql_source_header_secret_id_idx" ON "graphql_source_header" USING btree ("secret_id");--> statement-breakpoint

CREATE TABLE "graphql_source_query_param" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text_value" text,
	"secret_id" text,
	"secret_prefix" text,
	CONSTRAINT "graphql_source_query_param_scope_id_id_pk" PRIMARY KEY("scope_id","id")
);
--> statement-breakpoint
CREATE INDEX "graphql_source_query_param_scope_id_idx" ON "graphql_source_query_param" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "graphql_source_query_param_source_id_idx" ON "graphql_source_query_param" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "graphql_source_query_param_secret_id_idx" ON "graphql_source_query_param" USING btree ("secret_id");--> statement-breakpoint

-- New auth columns. `auth_kind` defaults to "none" so existing rows that
-- predate this migration are valid even if the json was null.
ALTER TABLE "graphql_source" ADD COLUMN "auth_kind" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "graphql_source" ADD COLUMN "auth_connection_id" text;--> statement-breakpoint
CREATE INDEX "graphql_source_auth_connection_id_idx" ON "graphql_source" USING btree ("auth_connection_id");--> statement-breakpoint

-- Backfill auth from the JSON column. Missing keys yield NULL, so a row
-- with auth=NULL or kind="none" leaves auth_connection_id NULL and
-- auth_kind defaulted to "none".
UPDATE "graphql_source"
SET
	"auth_kind" = COALESCE("auth"->>'kind', 'none'),
	"auth_connection_id" = "auth"->>'connectionId'
WHERE "auth" IS NOT NULL;--> statement-breakpoint

-- Backfill headers. For each (source, header_name) pair: if the value
-- is a json object with .secretId, write a kind=secret row; otherwise
-- write a kind=text row with the literal string. jsonb_each iterates
-- the keys of the headers object.
INSERT INTO "graphql_source_header"
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
FROM "graphql_source" s, jsonb_each(s."headers") h
WHERE s."headers" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Same for query_params.
INSERT INTO "graphql_source_query_param"
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
FROM "graphql_source" s, jsonb_each(s."query_params") q
WHERE s."query_params" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

ALTER TABLE "graphql_source" DROP COLUMN "headers";--> statement-breakpoint
ALTER TABLE "graphql_source" DROP COLUMN "query_params";--> statement-breakpoint
ALTER TABLE "graphql_source" DROP COLUMN "auth";
