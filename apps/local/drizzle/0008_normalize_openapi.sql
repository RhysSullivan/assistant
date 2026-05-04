-- Normalize openapi plugin: move every direct secret/connection ref out
-- of JSON columns into proper relational shape.
--
-- Old shape:
--   openapi_source.query_params      json   Record<name, string | {secretId,prefix?}>
--   openapi_source.invocation_config json   { specFetchCredentials?: { headers, queryParams } }
--   openapi_source_binding.value     json   discriminated union
--                                           {kind:"secret",secretId} | {kind:"connection",connectionId} | {kind:"text",text}
--
-- New shape:
--   openapi_source_binding gains kind/secret_id/connection_id/text_value columns.
--   `headers` / `oauth2` on openapi_source stay JSON because they hold
--   slot names, not direct refs — the actual credentials reach those
--   slots through openapi_source_binding rows, which ARE normalized.
--   openapi_source_query_param: child table, secret-backed entries.
--   openapi_source_spec_fetch_header / spec_fetch_query_param: child
--   tables for the equivalent maps inside specFetchCredentials.

CREATE TABLE `openapi_source_query_param` (
	`id` text NOT NULL,
	`scope_id` text NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`text_value` text,
	`secret_id` text,
	`secret_prefix` text,
	PRIMARY KEY(`scope_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `openapi_source_query_param_scope_id_idx` ON `openapi_source_query_param` (`scope_id`);--> statement-breakpoint
CREATE INDEX `openapi_source_query_param_source_id_idx` ON `openapi_source_query_param` (`source_id`);--> statement-breakpoint
CREATE INDEX `openapi_source_query_param_secret_id_idx` ON `openapi_source_query_param` (`secret_id`);--> statement-breakpoint

CREATE TABLE `openapi_source_spec_fetch_header` (
	`id` text NOT NULL,
	`scope_id` text NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`text_value` text,
	`secret_id` text,
	`secret_prefix` text,
	PRIMARY KEY(`scope_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `openapi_source_spec_fetch_header_scope_id_idx` ON `openapi_source_spec_fetch_header` (`scope_id`);--> statement-breakpoint
CREATE INDEX `openapi_source_spec_fetch_header_source_id_idx` ON `openapi_source_spec_fetch_header` (`source_id`);--> statement-breakpoint
CREATE INDEX `openapi_source_spec_fetch_header_secret_id_idx` ON `openapi_source_spec_fetch_header` (`secret_id`);--> statement-breakpoint

CREATE TABLE `openapi_source_spec_fetch_query_param` (
	`id` text NOT NULL,
	`scope_id` text NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`text_value` text,
	`secret_id` text,
	`secret_prefix` text,
	PRIMARY KEY(`scope_id`, `id`)
);
--> statement-breakpoint
CREATE INDEX `openapi_source_spec_fetch_query_param_scope_id_idx` ON `openapi_source_spec_fetch_query_param` (`scope_id`);--> statement-breakpoint
CREATE INDEX `openapi_source_spec_fetch_query_param_source_id_idx` ON `openapi_source_spec_fetch_query_param` (`source_id`);--> statement-breakpoint
CREATE INDEX `openapi_source_spec_fetch_query_param_secret_id_idx` ON `openapi_source_spec_fetch_query_param` (`secret_id`);--> statement-breakpoint

-- New columns on openapi_source_binding to flatten the value json.
-- `kind` defaults to 'text' so the ALTER works on existing rows; the
-- backfill below stamps the real value.
ALTER TABLE `openapi_source_binding` ADD `kind` text DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE `openapi_source_binding` ADD `secret_id` text;--> statement-breakpoint
ALTER TABLE `openapi_source_binding` ADD `connection_id` text;--> statement-breakpoint
ALTER TABLE `openapi_source_binding` ADD `text_value` text;--> statement-breakpoint
CREATE INDEX `openapi_source_binding_secret_id_idx` ON `openapi_source_binding` (`secret_id`);--> statement-breakpoint
CREATE INDEX `openapi_source_binding_connection_id_idx` ON `openapi_source_binding` (`connection_id`);--> statement-breakpoint

-- Backfill the binding columns from the legacy `value` JSON. We pull
-- $.kind into `kind` directly; for each kind the matching id field
-- (`secretId` / `connectionId` / `text`) gets copied into the matching
-- column. Rows whose value JSON is malformed or missing $.kind fall
-- through to kind='text' with a NULL text_value — same as a missing
-- text binding, the source will surface "binding not configured" at
-- invoke time rather than crashing the migration.
UPDATE `openapi_source_binding`
SET
	`kind` = COALESCE(json_extract(`value`, '$.kind'), 'text'),
	`secret_id` = CASE WHEN json_extract(`value`, '$.kind') = 'secret' THEN json_extract(`value`, '$.secretId') ELSE NULL END,
	`connection_id` = CASE WHEN json_extract(`value`, '$.kind') = 'connection' THEN json_extract(`value`, '$.connectionId') ELSE NULL END,
	`text_value` = CASE WHEN json_extract(`value`, '$.kind') = 'text' THEN json_extract(`value`, '$.text') ELSE NULL END
WHERE `value` IS NOT NULL;--> statement-breakpoint

-- Backfill openapi_source_query_param from openapi_source.query_params.
-- json_each iterates the keys of the query_params object. For each
-- entry: if the value is an object with .secretId, write a kind=secret
-- row; otherwise write a kind=text row with the literal string.
INSERT OR IGNORE INTO `openapi_source_query_param`
	(`scope_id`, `id`, `source_id`, `name`, `kind`, `text_value`, `secret_id`, `secret_prefix`)
SELECT
	s.`scope_id`,
	json_array(s.`id`, q.`key`),
	s.`id`,
	q.`key`,
	CASE
		WHEN q.`type` = 'object' AND json_extract(q.`value`, '$.secretId') IS NOT NULL THEN 'secret'
		ELSE 'text'
	END,
	CASE WHEN q.`type` = 'object' THEN NULL ELSE q.`value` END,
	CASE WHEN q.`type` = 'object' THEN json_extract(q.`value`, '$.secretId') ELSE NULL END,
	CASE WHEN q.`type` = 'object' THEN json_extract(q.`value`, '$.prefix') ELSE NULL END
FROM `openapi_source` s, json_each(s.`query_params`) q
WHERE s.`query_params` IS NOT NULL;--> statement-breakpoint

-- Backfill openapi_source_spec_fetch_header from
-- openapi_source.invocation_config.specFetchCredentials.headers. Same
-- shape as query_params; the JSON path is one level deeper.
INSERT OR IGNORE INTO `openapi_source_spec_fetch_header`
	(`scope_id`, `id`, `source_id`, `name`, `kind`, `text_value`, `secret_id`, `secret_prefix`)
SELECT
	s.`scope_id`,
	json_array(s.`id`, h.`key`),
	s.`id`,
	h.`key`,
	CASE
		WHEN h.`type` = 'object' AND json_extract(h.`value`, '$.secretId') IS NOT NULL THEN 'secret'
		ELSE 'text'
	END,
	CASE WHEN h.`type` = 'object' THEN NULL ELSE h.`value` END,
	CASE WHEN h.`type` = 'object' THEN json_extract(h.`value`, '$.secretId') ELSE NULL END,
	CASE WHEN h.`type` = 'object' THEN json_extract(h.`value`, '$.prefix') ELSE NULL END
FROM `openapi_source` s, json_each(json_extract(s.`invocation_config`, '$.specFetchCredentials.headers')) h
WHERE json_extract(s.`invocation_config`, '$.specFetchCredentials.headers') IS NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `openapi_source_spec_fetch_query_param`
	(`scope_id`, `id`, `source_id`, `name`, `kind`, `text_value`, `secret_id`, `secret_prefix`)
SELECT
	s.`scope_id`,
	json_array(s.`id`, q.`key`),
	s.`id`,
	q.`key`,
	CASE
		WHEN q.`type` = 'object' AND json_extract(q.`value`, '$.secretId') IS NOT NULL THEN 'secret'
		ELSE 'text'
	END,
	CASE WHEN q.`type` = 'object' THEN NULL ELSE q.`value` END,
	CASE WHEN q.`type` = 'object' THEN json_extract(q.`value`, '$.secretId') ELSE NULL END,
	CASE WHEN q.`type` = 'object' THEN json_extract(q.`value`, '$.prefix') ELSE NULL END
FROM `openapi_source` s, json_each(json_extract(s.`invocation_config`, '$.specFetchCredentials.queryParams')) q
WHERE json_extract(s.`invocation_config`, '$.specFetchCredentials.queryParams') IS NOT NULL;--> statement-breakpoint

-- Drop the legacy JSON columns now that everything is normalized.
ALTER TABLE `openapi_source_binding` DROP COLUMN `value`;--> statement-breakpoint
ALTER TABLE `openapi_source` DROP COLUMN `query_params`;--> statement-breakpoint
ALTER TABLE `openapi_source` DROP COLUMN `invocation_config`;
