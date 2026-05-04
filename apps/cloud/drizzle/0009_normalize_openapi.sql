-- Normalize openapi plugin: move every direct secret/connection ref out
-- of JSON columns into proper relational shape. pg port of
-- apps/local/drizzle/0008_normalize_openapi.sql.

CREATE TABLE "openapi_source_query_param" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text_value" text,
	"secret_id" text,
	"secret_prefix" text,
	CONSTRAINT "openapi_source_query_param_scope_id_id_pk" PRIMARY KEY("scope_id","id")
);
--> statement-breakpoint
CREATE INDEX "openapi_source_query_param_scope_id_idx" ON "openapi_source_query_param" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "openapi_source_query_param_source_id_idx" ON "openapi_source_query_param" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "openapi_source_query_param_secret_id_idx" ON "openapi_source_query_param" USING btree ("secret_id");--> statement-breakpoint

CREATE TABLE "openapi_source_spec_fetch_header" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text_value" text,
	"secret_id" text,
	"secret_prefix" text,
	CONSTRAINT "openapi_source_spec_fetch_header_scope_id_id_pk" PRIMARY KEY("scope_id","id")
);
--> statement-breakpoint
CREATE INDEX "openapi_source_spec_fetch_header_scope_id_idx" ON "openapi_source_spec_fetch_header" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "openapi_source_spec_fetch_header_source_id_idx" ON "openapi_source_spec_fetch_header" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "openapi_source_spec_fetch_header_secret_id_idx" ON "openapi_source_spec_fetch_header" USING btree ("secret_id");--> statement-breakpoint

CREATE TABLE "openapi_source_spec_fetch_query_param" (
	"id" text NOT NULL,
	"scope_id" text NOT NULL,
	"source_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"text_value" text,
	"secret_id" text,
	"secret_prefix" text,
	CONSTRAINT "openapi_source_spec_fetch_query_param_scope_id_id_pk" PRIMARY KEY("scope_id","id")
);
--> statement-breakpoint
CREATE INDEX "openapi_source_spec_fetch_query_param_scope_id_idx" ON "openapi_source_spec_fetch_query_param" USING btree ("scope_id");--> statement-breakpoint
CREATE INDEX "openapi_source_spec_fetch_query_param_source_id_idx" ON "openapi_source_spec_fetch_query_param" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "openapi_source_spec_fetch_query_param_secret_id_idx" ON "openapi_source_spec_fetch_query_param" USING btree ("secret_id");--> statement-breakpoint

-- New columns on openapi_source_binding to flatten the value json.
-- `kind` defaults to 'text' so the ALTER works on existing rows; the
-- backfill below stamps the real value.
ALTER TABLE "openapi_source_binding" ADD COLUMN "kind" text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "openapi_source_binding" ADD COLUMN "secret_id" text;--> statement-breakpoint
ALTER TABLE "openapi_source_binding" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "openapi_source_binding" ADD COLUMN "text_value" text;--> statement-breakpoint
CREATE INDEX "openapi_source_binding_secret_id_idx" ON "openapi_source_binding" USING btree ("secret_id");--> statement-breakpoint
CREATE INDEX "openapi_source_binding_connection_id_idx" ON "openapi_source_binding" USING btree ("connection_id");--> statement-breakpoint

UPDATE "openapi_source_binding"
SET
	"kind" = COALESCE("value"->>'kind', 'text'),
	"secret_id" = CASE WHEN "value"->>'kind' = 'secret' THEN "value"->>'secretId' ELSE NULL END,
	"connection_id" = CASE WHEN "value"->>'kind' = 'connection' THEN "value"->>'connectionId' ELSE NULL END,
	"text_value" = CASE WHEN "value"->>'kind' = 'text' THEN "value"->>'text' ELSE NULL END
WHERE "value" IS NOT NULL;--> statement-breakpoint

INSERT INTO "openapi_source_query_param"
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
FROM "openapi_source" s, jsonb_each(s."query_params") q
WHERE s."query_params" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "openapi_source_spec_fetch_header"
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
FROM "openapi_source" s, jsonb_each(s."invocation_config"->'specFetchCredentials'->'headers') h
WHERE s."invocation_config"->'specFetchCredentials'->'headers' IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO "openapi_source_spec_fetch_query_param"
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
FROM "openapi_source" s, jsonb_each(s."invocation_config"->'specFetchCredentials'->'queryParams') q
WHERE s."invocation_config"->'specFetchCredentials'->'queryParams' IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

ALTER TABLE "openapi_source_binding" DROP COLUMN "value";--> statement-breakpoint
ALTER TABLE "openapi_source" DROP COLUMN "query_params";--> statement-breakpoint
ALTER TABLE "openapi_source" DROP COLUMN "invocation_config";
