UPDATE "source_recipe_operations"
SET "provider_data_json" = CASE
	WHEN "provider_kind" = 'openapi' THEN jsonb_strip_nulls(jsonb_build_object(
		'kind', 'openapi',
		'toolId', "tool_id",
		'rawToolId', COALESCE("openapi_raw_tool_id", "tool_id"),
		'operationId', "openapi_operation_id",
		'group', CASE
			WHEN position('.' in "tool_id") > 0 THEN split_part("tool_id", '.', 1)
			ELSE "tool_id"
		END,
		'leaf', CASE
			WHEN position('.' in "tool_id") > 0 THEN substring("tool_id" from position('.' in "tool_id") + 1)
			ELSE "tool_id"
		END,
		'tags', CASE
			WHEN "openapi_tags_json" IS NOT NULL THEN "openapi_tags_json"::jsonb
			ELSE '[]'::jsonb
		END,
		'method', COALESCE("openapi_method", 'get'),
		'path', COALESCE("openapi_path_template", '/'),
		'operationHash', COALESCE(
			"openapi_operation_hash",
			md5(COALESCE("tool_id", '') || ':' || COALESCE("openapi_path_template", '/'))
		),
		'invocation', jsonb_build_object(
			'method', COALESCE("openapi_method", 'get'),
			'pathTemplate', COALESCE("openapi_path_template", '/'),
			'parameters', '[]'::jsonb,
			'requestBody', CASE
				WHEN "openapi_request_body_required" IS NULL THEN null
				ELSE jsonb_build_object(
					'required', "openapi_request_body_required",
					'contentTypes', '[]'::jsonb
				)
			END
		)
	))::text
	WHEN "provider_kind" = 'graphql' THEN jsonb_build_object(
		'kind', 'graphql',
		'toolKind', 'field',
		'toolId', "tool_id",
		'rawToolId', null,
		'group', null,
		'leaf', null,
		'fieldName', null,
		'operationType', "graphql_operation_type",
		'operationName', "graphql_operation_name",
		'operationDocument', null,
		'queryTypeName', null,
		'mutationTypeName', null,
		'subscriptionTypeName', null
	)::text
	WHEN "provider_kind" = 'mcp' THEN jsonb_build_object(
		'kind', 'mcp',
		'toolId', "tool_id",
		'toolName', COALESCE("mcp_tool_name", "title", "tool_id"),
		'description', "description"
	)::text
	ELSE "provider_data_json"
END
WHERE "provider_data_json" IS NULL;--> statement-breakpoint

ALTER TABLE "source_recipe_operations" DROP COLUMN "mcp_tool_name";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "openapi_method";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "openapi_path_template";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "openapi_operation_hash";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "openapi_raw_tool_id";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "openapi_operation_id";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "openapi_tags_json";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "openapi_request_body_required";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "graphql_operation_type";--> statement-breakpoint
ALTER TABLE "source_recipe_operations" DROP COLUMN "graphql_operation_name";--> statement-breakpoint
