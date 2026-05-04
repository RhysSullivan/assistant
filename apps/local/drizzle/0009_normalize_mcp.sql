-- Normalize mcp plugin: lift the McpConnectionAuth secret/connection
-- refs and the SecretBackedMap headers/query_params out of
-- mcp_source.config JSON into proper columns / child tables.
--
-- Old shape:
--   mcp_source.config (json) — McpStoredSourceData discriminated union
--     remote: { transport, endpoint, remoteTransport?, queryParams?,
--               headers?, auth: McpConnectionAuth }
--     stdio:  { transport, command, args?, env?, cwd? }
--
-- New shape:
--   mcp_source gains: auth_kind enum, auth_header_name, auth_secret_id,
--     auth_secret_prefix, auth_connection_id, auth_client_id_secret_id,
--     auth_client_secret_secret_id. The remaining structural fields
--     stay in `config` as JSON because they're plugin-private and
--     vary by transport.
--   mcp_source_header / mcp_source_query_param: child tables for
--     remote sources' SecretBackedMap entries (same column shape as
--     graphql_source_header / openapi_source_query_param).

CREATE TABLE `mcp_source_header` (
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
CREATE INDEX `mcp_source_header_scope_id_idx` ON `mcp_source_header` (`scope_id`);--> statement-breakpoint
CREATE INDEX `mcp_source_header_source_id_idx` ON `mcp_source_header` (`source_id`);--> statement-breakpoint
CREATE INDEX `mcp_source_header_secret_id_idx` ON `mcp_source_header` (`secret_id`);--> statement-breakpoint

CREATE TABLE `mcp_source_query_param` (
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
CREATE INDEX `mcp_source_query_param_scope_id_idx` ON `mcp_source_query_param` (`scope_id`);--> statement-breakpoint
CREATE INDEX `mcp_source_query_param_source_id_idx` ON `mcp_source_query_param` (`source_id`);--> statement-breakpoint
CREATE INDEX `mcp_source_query_param_secret_id_idx` ON `mcp_source_query_param` (`secret_id`);--> statement-breakpoint

-- New auth columns. `auth_kind` defaults to "none" so the ALTER passes
-- on existing rows; the backfill below stamps the real value.
ALTER TABLE `mcp_source` ADD `auth_kind` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `mcp_source` ADD `auth_header_name` text;--> statement-breakpoint
ALTER TABLE `mcp_source` ADD `auth_secret_id` text;--> statement-breakpoint
ALTER TABLE `mcp_source` ADD `auth_secret_prefix` text;--> statement-breakpoint
ALTER TABLE `mcp_source` ADD `auth_connection_id` text;--> statement-breakpoint
ALTER TABLE `mcp_source` ADD `auth_client_id_secret_id` text;--> statement-breakpoint
ALTER TABLE `mcp_source` ADD `auth_client_secret_secret_id` text;--> statement-breakpoint
CREATE INDEX `mcp_source_auth_secret_id_idx` ON `mcp_source` (`auth_secret_id`);--> statement-breakpoint
CREATE INDEX `mcp_source_auth_connection_id_idx` ON `mcp_source` (`auth_connection_id`);--> statement-breakpoint
CREATE INDEX `mcp_source_auth_client_id_secret_id_idx` ON `mcp_source` (`auth_client_id_secret_id`);--> statement-breakpoint
CREATE INDEX `mcp_source_auth_client_secret_secret_id_idx` ON `mcp_source` (`auth_client_secret_secret_id`);--> statement-breakpoint

-- Backfill auth columns from config.auth — but only for rows whose
-- config.auth matches the *current* shape:
--   - kind=none           (no extra fields)
--   - kind=header         (secretId present)
--   - kind=oauth2         (connectionId present)
-- Truly-legacy rows (inline OAuth shape with accessTokenSecretId etc.)
-- are left untouched here so the post-migrate `migrateLegacyConnections`
-- script can convert them to a Connection and write the resulting
-- pointer to these columns. Setting auth_kind explicitly to NULL/none
-- on those rows would lose the legacy payload before it gets converted.
UPDATE `mcp_source`
SET
	`auth_kind` = json_extract(`config`, '$.auth.kind'),
	`auth_header_name` = json_extract(`config`, '$.auth.headerName'),
	`auth_secret_id` = json_extract(`config`, '$.auth.secretId'),
	`auth_secret_prefix` = json_extract(`config`, '$.auth.prefix'),
	`auth_connection_id` = json_extract(`config`, '$.auth.connectionId'),
	`auth_client_id_secret_id` = json_extract(`config`, '$.auth.clientIdSecretId'),
	`auth_client_secret_secret_id` = json_extract(`config`, '$.auth.clientSecretSecretId')
WHERE `config` IS NOT NULL
  AND (
    -- kind=none and "no auth at all" both leave auth_kind defaulted to
    -- 'none' (the column DEFAULT), so we only UPDATE rows that have a
    -- non-trivial current-shape auth payload to extract.
    (
      json_extract(`config`, '$.auth.kind') = 'header'
      AND json_extract(`config`, '$.auth.secretId') IS NOT NULL
    )
    OR (
      json_extract(`config`, '$.auth.kind') = 'oauth2'
      AND json_extract(`config`, '$.auth.connectionId') IS NOT NULL
    )
  );--> statement-breakpoint

-- Backfill mcp_source_header from config.headers. Remote sources only;
-- stdio's config has no `.headers` key so json_each returns nothing.
INSERT OR IGNORE INTO `mcp_source_header`
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
FROM `mcp_source` s, json_each(json_extract(s.`config`, '$.headers')) h
WHERE json_extract(s.`config`, '$.headers') IS NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `mcp_source_query_param`
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
FROM `mcp_source` s, json_each(json_extract(s.`config`, '$.queryParams')) q
WHERE json_extract(s.`config`, '$.queryParams') IS NOT NULL;--> statement-breakpoint

-- Strip the now-extracted fields from the legacy config JSON. Skip
-- rows whose config.auth still holds a legacy inline-OAuth payload —
-- migrateLegacyConnections needs to read it to mint the matching
-- Connection. headers/queryParams are always safe to strip (already
-- copied to child tables). SQLite's json_remove returns the input
-- unchanged when a path is missing, so stdio rows pass through
-- cleanly.
UPDATE `mcp_source`
SET `config` = json_remove(`config`, '$.headers', '$.queryParams')
WHERE `config` IS NOT NULL;--> statement-breakpoint

UPDATE `mcp_source`
SET `config` = json_remove(`config`, '$.auth')
WHERE `config` IS NOT NULL
  AND (
    json_extract(`config`, '$.auth.kind') = 'none'
    OR (
      json_extract(`config`, '$.auth.kind') = 'header'
      AND json_extract(`config`, '$.auth.secretId') IS NOT NULL
    )
    OR (
      json_extract(`config`, '$.auth.kind') = 'oauth2'
      AND json_extract(`config`, '$.auth.connectionId') IS NOT NULL
    )
  );
