-- Normalize graphql plugin: move secret/connection refs out of JSON
-- columns into proper relational shape so usagesForSecret /
-- usagesForConnection are one indexed SELECT instead of a JSON scan.
--
-- Old shape:
--   graphql_source.headers      json   Record<name, string | {secretId,prefix?}>
--   graphql_source.query_params json   Record<name, string | {secretId,prefix?}>
--   graphql_source.auth         json   {kind:"none"} | {kind:"oauth2", connectionId}
--
-- New shape:
--   graphql_source.auth_kind          enum("none","oauth2") NOT NULL
--   graphql_source.auth_connection_id text indexed nullable
--   graphql_source_header(scope_id, id, source_id, name, kind, text_value, secret_id, secret_prefix)
--   graphql_source_query_param(scope_id, id, source_id, name, kind, text_value, secret_id, secret_prefix)

CREATE TABLE `graphql_source_header` (
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
CREATE INDEX `graphql_source_header_scope_id_idx` ON `graphql_source_header` (`scope_id`);--> statement-breakpoint
CREATE INDEX `graphql_source_header_source_id_idx` ON `graphql_source_header` (`source_id`);--> statement-breakpoint
CREATE INDEX `graphql_source_header_secret_id_idx` ON `graphql_source_header` (`secret_id`);--> statement-breakpoint

CREATE TABLE `graphql_source_query_param` (
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
CREATE INDEX `graphql_source_query_param_scope_id_idx` ON `graphql_source_query_param` (`scope_id`);--> statement-breakpoint
CREATE INDEX `graphql_source_query_param_source_id_idx` ON `graphql_source_query_param` (`source_id`);--> statement-breakpoint
CREATE INDEX `graphql_source_query_param_secret_id_idx` ON `graphql_source_query_param` (`secret_id`);--> statement-breakpoint

-- New auth columns. `auth_kind` defaults to "none" so existing rows that
-- predate this migration are valid even if the json was null.
ALTER TABLE `graphql_source` ADD `auth_kind` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `graphql_source` ADD `auth_connection_id` text;--> statement-breakpoint
CREATE INDEX `graphql_source_auth_connection_id_idx` ON `graphql_source` (`auth_connection_id`);--> statement-breakpoint

-- Backfill auth from the JSON column. json_extract returns NULL for
-- missing paths, so a row with auth=NULL or kind="none" leaves
-- auth_connection_id NULL and auth_kind defaulted to "none".
UPDATE `graphql_source`
SET
	`auth_kind` = COALESCE(json_extract(`auth`, '$.kind'), 'none'),
	`auth_connection_id` = json_extract(`auth`, '$.connectionId')
WHERE `auth` IS NOT NULL;--> statement-breakpoint

-- Backfill headers. For each (source, header_name) pair: if the value
-- is a json object with .secretId, write a kind=secret row; otherwise
-- write a kind=text row with the literal string. json_each iterates
-- the keys of the headers object.
INSERT OR IGNORE INTO `graphql_source_header`
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
FROM `graphql_source` s, json_each(s.`headers`) h
WHERE s.`headers` IS NOT NULL;--> statement-breakpoint

-- Same for query_params.
INSERT OR IGNORE INTO `graphql_source_query_param`
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
FROM `graphql_source` s, json_each(s.`query_params`) q
WHERE s.`query_params` IS NOT NULL;--> statement-breakpoint

-- Drop the old JSON columns. SQLite ≥ 3.35 supports ALTER TABLE DROP
-- COLUMN directly; bun's bundled SQLite is well past that.
ALTER TABLE `graphql_source` DROP COLUMN `headers`;--> statement-breakpoint
ALTER TABLE `graphql_source` DROP COLUMN `query_params`;--> statement-breakpoint
ALTER TABLE `graphql_source` DROP COLUMN `auth`;
