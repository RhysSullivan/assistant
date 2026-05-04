-- Normalize google-discovery plugin: lift the GoogleDiscoveryAuth and
-- the credentials.{headers,queryParams} SecretBackedMaps out of
-- google_discovery_source.config JSON.
--
-- Old shape:
--   google_discovery_source.config (json) — GoogleDiscoveryStoredSourceData
--     with `auth: {kind:"none"} | {kind:"oauth2", connectionId, clientId..., clientSecret..., scopes}`
--     and optional `credentials: { headers?, queryParams? }`
--
-- New shape:
--   google_discovery_source gains: auth_kind, auth_connection_id,
--     auth_client_id_secret_id, auth_client_secret_secret_id, auth_scopes.
--   google_discovery_source_credential_header / _query_param: child
--     tables for the SecretBackedMap entries.

CREATE TABLE `google_discovery_source_credential_header` (
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
CREATE INDEX `google_discovery_source_credential_header_scope_id_idx` ON `google_discovery_source_credential_header` (`scope_id`);--> statement-breakpoint
CREATE INDEX `google_discovery_source_credential_header_source_id_idx` ON `google_discovery_source_credential_header` (`source_id`);--> statement-breakpoint
CREATE INDEX `google_discovery_source_credential_header_secret_id_idx` ON `google_discovery_source_credential_header` (`secret_id`);--> statement-breakpoint

CREATE TABLE `google_discovery_source_credential_query_param` (
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
CREATE INDEX `google_discovery_source_credential_query_param_scope_id_idx` ON `google_discovery_source_credential_query_param` (`scope_id`);--> statement-breakpoint
CREATE INDEX `google_discovery_source_credential_query_param_source_id_idx` ON `google_discovery_source_credential_query_param` (`source_id`);--> statement-breakpoint
CREATE INDEX `google_discovery_source_credential_query_param_secret_id_idx` ON `google_discovery_source_credential_query_param` (`secret_id`);--> statement-breakpoint

ALTER TABLE `google_discovery_source` ADD `auth_kind` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `google_discovery_source` ADD `auth_connection_id` text;--> statement-breakpoint
ALTER TABLE `google_discovery_source` ADD `auth_client_id_secret_id` text;--> statement-breakpoint
ALTER TABLE `google_discovery_source` ADD `auth_client_secret_secret_id` text;--> statement-breakpoint
ALTER TABLE `google_discovery_source` ADD `auth_scopes` text;--> statement-breakpoint
CREATE INDEX `google_discovery_source_auth_connection_id_idx` ON `google_discovery_source` (`auth_connection_id`);--> statement-breakpoint
CREATE INDEX `google_discovery_source_auth_client_id_secret_id_idx` ON `google_discovery_source` (`auth_client_id_secret_id`);--> statement-breakpoint
CREATE INDEX `google_discovery_source_auth_client_secret_secret_id_idx` ON `google_discovery_source` (`auth_client_secret_secret_id`);--> statement-breakpoint

-- Backfill auth columns from config.auth.
UPDATE `google_discovery_source`
SET
	`auth_kind` = COALESCE(json_extract(`config`, '$.auth.kind'), 'none'),
	`auth_connection_id` = json_extract(`config`, '$.auth.connectionId'),
	`auth_client_id_secret_id` = json_extract(`config`, '$.auth.clientIdSecretId'),
	`auth_client_secret_secret_id` = json_extract(`config`, '$.auth.clientSecretSecretId'),
	`auth_scopes` = json_extract(`config`, '$.auth.scopes')
WHERE `config` IS NOT NULL;--> statement-breakpoint

-- Backfill credential header / query_param child rows.
INSERT OR IGNORE INTO `google_discovery_source_credential_header`
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
FROM `google_discovery_source` s, json_each(json_extract(s.`config`, '$.credentials.headers')) h
WHERE json_extract(s.`config`, '$.credentials.headers') IS NOT NULL;--> statement-breakpoint

INSERT OR IGNORE INTO `google_discovery_source_credential_query_param`
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
FROM `google_discovery_source` s, json_each(json_extract(s.`config`, '$.credentials.queryParams')) q
WHERE json_extract(s.`config`, '$.credentials.queryParams') IS NOT NULL;--> statement-breakpoint

-- Strip the extracted fields from the legacy config JSON.
UPDATE `google_discovery_source`
SET `config` = json_remove(`config`, '$.auth', '$.credentials')
WHERE `config` IS NOT NULL;
