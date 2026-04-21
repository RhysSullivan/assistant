// ---------------------------------------------------------------------------
// OpenAPI OAuth legacy → Connection backfill (local)
// ---------------------------------------------------------------------------
//
// Runs at boot time right after `migrate()`. For every `openapi_source`
// row still on the pre-refactor OAuth2 shape, mints a Connection row,
// re-parents the referenced secret(s) to it, and rewrites both the
// top-level `oauth2` column and the nested `invocation_config.oauth2`
// copy to the new pointer shape.
//
// Self-contained: the only plugin imports are current-shape parsing
// helpers. The pre-refactor shape is defined inline — this file is the
// last place in the codebase that still needs to know about it.

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { Effect, Option, Schema } from "effect";
import { FetchHttpClient } from "@effect/platform";
import {
  parse as parseOpenApi,
  resolveSpecText,
  OAuth2Auth,
} from "@executor/plugin-openapi";

const OAuth2Flow = Schema.Literal("authorizationCode", "clientCredentials");

class LegacyOAuth2Auth extends Schema.Class<LegacyOAuth2Auth>("LegacyOAuth2Auth")({
  kind: Schema.Literal("oauth2"),
  securitySchemeName: Schema.String,
  flow: OAuth2Flow,
  tokenUrl: Schema.String,
  clientIdSecretId: Schema.String,
  clientSecretSecretId: Schema.NullOr(Schema.String),
  accessTokenSecretId: Schema.String,
  refreshTokenSecretId: Schema.NullOr(Schema.String),
  tokenType: Schema.String,
  expiresAt: Schema.NullOr(Schema.Number),
  scope: Schema.NullOr(Schema.String),
  scopes: Schema.Array(Schema.String),
}) {}

const decodeCurrent = Schema.decodeUnknownOption(OAuth2Auth);
const decodeLegacy = Schema.decodeUnknownOption(LegacyOAuth2Auth);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

const extractAuthorizationUrl = async (
  rawSpec: string,
  securitySchemeName: string,
  flow: "authorizationCode" | "clientCredentials",
): Promise<string | null> => {
  if (flow === "clientCredentials") return null;
  const parsed = await Effect.runPromise(
    resolveSpecText(rawSpec).pipe(
      Effect.flatMap((text) => parseOpenApi(text)),
      Effect.provide(FetchHttpClient.layer),
      Effect.either,
    ),
  );
  if (parsed._tag === "Left") return null;
  const spec = parsed.right as unknown;
  if (!isRecord(spec)) return null;
  const components = isRecord(spec.components) ? spec.components : null;
  const schemes = components && isRecord(components.securitySchemes)
    ? components.securitySchemes
    : null;
  const scheme = schemes && isRecord(schemes[securitySchemeName])
    ? (schemes[securitySchemeName] as Record<string, unknown>)
    : null;
  const flows = scheme && isRecord(scheme.flows) ? scheme.flows : null;
  const flowObj = flows && isRecord(flows.authorizationCode)
    ? (flows.authorizationCode as Record<string, unknown>)
    : null;
  return flowObj && isString(flowObj.authorizationUrl)
    ? flowObj.authorizationUrl
    : null;
};

type Row = {
  scope_id: string;
  id: string;
  name: string;
  spec: string;
  invocation_config: string | null;
  oauth2: string | null;
};

/**
 * Scan `openapi_source`, migrate any row still on the legacy OAuth2 shape
 * to a fresh Connection row + pointer. Idempotent — rows already on the
 * current shape are skipped. Logs one line per migrated row.
 */
export const migrateOpenApiOAuthConnections = async (sqlite: Database): Promise<void> => {
  // The 0002_lively_sue_storm migration introduced the `connection` table
  // and added `secret.owned_by_connection_id`. If those aren't present yet,
  // the drizzle `migrate()` call upstream hasn't finished — bail.
  const secretColumns = sqlite
    .prepare("PRAGMA table_info('secret')")
    .all() as ReadonlyArray<{ readonly name: string }>;
  if (!secretColumns.some((c) => c.name === "owned_by_connection_id")) {
    return;
  }
  const connectionTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connection'")
    .get();
  if (!connectionTable) return;

  const rows = sqlite
    .prepare(
      "SELECT scope_id, id, name, spec, invocation_config, oauth2 FROM openapi_source",
    )
    .all() as ReadonlyArray<Row>;
  if (rows.length === 0) return;

  const insertConnection = sqlite.prepare(
    `INSERT INTO connection (
       id, scope_id, provider, kind, identity_label,
       access_token_secret_id, refresh_token_secret_id,
       expires_at, scope, provider_state,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const updateSecretOwner = sqlite.prepare(
    "UPDATE secret SET owned_by_connection_id = ? WHERE scope_id = ? AND id = ?",
  );
  const selectSecret = sqlite.prepare(
    "SELECT id, owned_by_connection_id FROM secret WHERE scope_id = ? AND id = ?",
  );
  const selectAnySecretProvider = sqlite.prepare(
    "SELECT provider FROM secret WHERE scope_id = ? LIMIT 1",
  );
  const insertSecret = sqlite.prepare(
    `INSERT INTO secret (
       id, scope_id, provider, name,
       owned_by_connection_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updateSource = sqlite.prepare(
    "UPDATE openapi_source SET oauth2 = ?, invocation_config = ? WHERE scope_id = ? AND id = ?",
  );

  for (const row of rows) {
    let invocation: Record<string, unknown> = {};
    if (row.invocation_config) {
      try {
        const parsed = JSON.parse(row.invocation_config) as unknown;
        if (isRecord(parsed)) invocation = parsed;
      } catch {
        continue;
      }
    }
    let oauth2Col: unknown = null;
    if (row.oauth2) {
      try {
        oauth2Col = JSON.parse(row.oauth2) as unknown;
      } catch {
        // fall through
      }
    }
    const primary = invocation.oauth2 ?? oauth2Col;
    if (primary == null) continue;
    if (Option.isSome(decodeCurrent(primary))) continue;

    const legacyOption = decodeLegacy(primary);
    if (Option.isNone(legacyOption)) continue;
    const legacy = legacyOption.value;

    const authorizationUrl = await extractAuthorizationUrl(
      row.spec,
      legacy.securitySchemeName,
      legacy.flow,
    );
    if (legacy.flow === "authorizationCode" && authorizationUrl === null) {
      console.warn(
        `[migrate-connections] skip ${row.scope_id}/${row.id}: authorizationCode flow but authorizationUrl unavailable`,
      );
      continue;
    }

    const connectionId = `openapi-oauth2-${randomUUID()}`;
    const providerState = {
      flow: legacy.flow,
      tokenUrl: legacy.tokenUrl,
      clientIdSecretId: legacy.clientIdSecretId,
      clientSecretSecretId: legacy.clientSecretSecretId,
      scopes: legacy.scopes,
    };
    const oauth2Pointer = {
      kind: "oauth2" as const,
      connectionId,
      securitySchemeName: legacy.securitySchemeName,
      flow: legacy.flow,
      tokenUrl: legacy.tokenUrl,
      authorizationUrl,
      clientIdSecretId: legacy.clientIdSecretId,
      clientSecretSecretId: legacy.clientSecretSecretId,
      scopes: legacy.scopes,
    };

    const secretIds = [legacy.accessTokenSecretId];
    if (legacy.refreshTokenSecretId) secretIds.push(legacy.refreshTokenSecretId);

    const secretRows = secretIds.map(
      (sid) =>
        selectSecret.get(row.scope_id, sid) as
          | { id: string; owned_by_connection_id: string | null }
          | undefined,
    );
    const alreadyOwned = secretRows
      .filter((s): s is { id: string; owned_by_connection_id: string | null } => !!s)
      .filter(
        (s) =>
          s.owned_by_connection_id !== null &&
          s.owned_by_connection_id !== connectionId,
      );
    if (alreadyOwned.length > 0) {
      console.warn(
        `[migrate-connections] skip ${row.scope_id}/${row.id}: secret(s) already owned`,
      );
      continue;
    }
    // Early-onboarded OpenAPI OAuth tokens never got a `secret` routing
    // row — pre-refactor `secretsGet` resolved them via provider
    // enumeration. Pick the provider already in use at this scope (or
    // fall back to keychain) so the new id-indexed fast path resolves;
    // if we guess wrong the SDK's enumerate-fallback still works.
    const missingIndexes = secretIds
      .map((_, i) => i)
      .filter((i) => secretRows[i] === undefined);
    let fallbackProvider: string | null = null;
    if (missingIndexes.length > 0) {
      const existing = selectAnySecretProvider.get(row.scope_id) as
        | { provider: string }
        | undefined;
      fallbackProvider = existing?.provider ?? "keychain";
    }

    const now = Date.now();
    const txn = sqlite.transaction(() => {
      insertConnection.run(
        connectionId,
        row.scope_id,
        "openapi:oauth2",
        "user",
        row.name,
        legacy.accessTokenSecretId,
        legacy.refreshTokenSecretId,
        legacy.expiresAt,
        legacy.scope,
        JSON.stringify(providerState),
        now,
        now,
      );
      for (let i = 0; i < secretIds.length; i++) {
        const sid = secretIds[i]!;
        if (secretRows[i] === undefined) {
          const name =
            sid === legacy.accessTokenSecretId
              ? `Connection ${connectionId} access token`
              : `Connection ${connectionId} refresh token`;
          insertSecret.run(
            sid,
            row.scope_id,
            fallbackProvider!,
            name,
            connectionId,
            now,
          );
        } else {
          updateSecretOwner.run(connectionId, row.scope_id, sid);
        }
      }
      const nextInvocation = { ...invocation, oauth2: oauth2Pointer };
      updateSource.run(
        JSON.stringify(oauth2Pointer),
        JSON.stringify(nextInvocation),
        row.scope_id,
        row.id,
      );
    });
    try {
      txn();
      console.log(
        `[migrate-connections] ${row.scope_id}/${row.id} -> ${connectionId}`,
      );
    } catch (err) {
      console.warn(
        `[migrate-connections] fail ${row.scope_id}/${row.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
};
