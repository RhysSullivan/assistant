import { Schema } from "effect";

// ---------------------------------------------------------------------------
// Auth — how to talk to 1Password
// ---------------------------------------------------------------------------

export class DesktopAppAuth extends Schema.Class<DesktopAppAuth>("DesktopAppAuth")({
  kind: Schema.Literal("desktop-app"),
  /** 1Password account domain, e.g. "my.1password.com" */
  accountName: Schema.String,
}) {}

export class ServiceAccountAuth extends Schema.Class<ServiceAccountAuth>("ServiceAccountAuth")({
  kind: Schema.Literal("service-account"),
  /** The service account token (stored as a secret) */
  tokenSecretId: Schema.String,
}) {}

export const OnePasswordAuth = Schema.Union(DesktopAppAuth, ServiceAccountAuth);
export type OnePasswordAuth = typeof OnePasswordAuth.Type;

// ---------------------------------------------------------------------------
// Stored config — persisted via KV
// ---------------------------------------------------------------------------

export class OnePasswordConfig extends Schema.Class<OnePasswordConfig>("OnePasswordConfig")({
  auth: OnePasswordAuth,
  /** Vault to scope operations to */
  vaultId: Schema.String,
  /** Human label */
  name: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export class Vault extends Schema.Class<Vault>("Vault")({
  id: Schema.String,
  name: Schema.String,
}) {}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------

export class ConnectionStatus extends Schema.Class<ConnectionStatus>("ConnectionStatus")({
  connected: Schema.Boolean,
  vaultName: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
}) {}
