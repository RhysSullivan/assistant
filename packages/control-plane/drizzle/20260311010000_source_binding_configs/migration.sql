UPDATE "sources"
SET "binding_config_json" = CASE
  WHEN "binding_config_json" IS NOT NULL AND btrim("binding_config_json") <> '' THEN "binding_config_json"
  WHEN "kind" = 'openapi' THEN jsonb_build_object(
    'adapterKey', 'openapi',
    'specUrl', COALESCE("spec_url", "endpoint"),
    'defaultHeaders',
      CASE
        WHEN "default_headers_json" IS NULL OR btrim("default_headers_json") = '' THEN NULL
        ELSE "default_headers_json"::jsonb
      END
  )::text
  WHEN "kind" = 'graphql' THEN jsonb_build_object(
    'adapterKey', 'graphql',
    'defaultHeaders',
      CASE
        WHEN "default_headers_json" IS NULL OR btrim("default_headers_json") = '' THEN NULL
        ELSE "default_headers_json"::jsonb
      END
  )::text
  WHEN "kind" = 'mcp' THEN jsonb_build_object(
    'adapterKey', 'mcp',
    'transport', "transport",
    'queryParams',
      CASE
        WHEN "query_params_json" IS NULL OR btrim("query_params_json") = '' THEN NULL
        ELSE "query_params_json"::jsonb
      END,
    'headers',
      CASE
        WHEN "headers_json" IS NULL OR btrim("headers_json") = '' THEN NULL
        ELSE "headers_json"::jsonb
      END
  )::text
  ELSE jsonb_build_object(
    'adapterKey', "kind"
  )::text
END;--> statement-breakpoint

ALTER TABLE "sources"
ALTER COLUMN "binding_config_json" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "sources"
DROP CONSTRAINT IF EXISTS "sources_transport_check";--> statement-breakpoint

ALTER TABLE "sources"
DROP COLUMN IF EXISTS "transport";--> statement-breakpoint

ALTER TABLE "sources"
DROP COLUMN IF EXISTS "query_params_json";--> statement-breakpoint

ALTER TABLE "sources"
DROP COLUMN IF EXISTS "headers_json";--> statement-breakpoint

ALTER TABLE "sources"
DROP COLUMN IF EXISTS "spec_url";--> statement-breakpoint

ALTER TABLE "sources"
DROP COLUMN IF EXISTS "default_headers_json";--> statement-breakpoint

ALTER TABLE "sources"
DROP COLUMN IF EXISTS "source_document_text";
