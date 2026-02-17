import { Result } from "better-result";
import { z } from "zod";
import type { CredentialProvider, CredentialRecord } from "./types";
import { parseWorkosVaultReference } from "./credentials/workos-vault";

type CredentialPayload = Record<string, unknown>;

export interface VaultReadInput {
  objectId: string;
  apiKey?: string;
}

export type VaultObjectReader = (input: VaultReadInput) => Promise<string>;

type ProviderResolver = (
  record: Pick<CredentialRecord, "provider" | "secretJson">,
  readVaultObject: VaultObjectReader,
) => Promise<Result<CredentialPayload | null, Error>>;

const recordSchema = z.record(z.unknown());
function coerceRecord(value: unknown): Record<string, unknown> {
  const parsed = recordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

const envSecretKeySchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);

async function defaultReadVaultObject(input: VaultReadInput): Promise<string> {
  throw new Error(
    `WorkOS Vault reader unavailable for object '${input.objectId}'. Provide a readVaultObject option in this runtime.`,
  );
}

function parseSecretValue(raw: string): CredentialPayload {
  const value = raw.trim();
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    const asObject = coerceRecord(parsed);
    if (Object.keys(asObject).length > 0) {
      return asObject;
    }
  } catch {
    // Continue with env-style and token fallback parsing.
  }

  const envStyleResult = parseEnvStyleSecret(value);
  if (envStyleResult) {
    return envStyleResult;
  }

  return { token: value };
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const startsWithSingle = value.startsWith("'") && value.endsWith("'");
  const startsWithDouble = value.startsWith('"') && value.endsWith('"');
  return startsWithSingle || startsWithDouble ? value.slice(1, -1) : value;
}

function parseEnvStyleSecret(raw: string): CredentialPayload | null {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length === 0) {
    return null;
  }

  const parsedPayload: CredentialPayload = {};
  for (const line of lines) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return null;
    }

    const keyRaw = line.slice(0, separatorIndex).trim();
    const keyResult = envSecretKeySchema.safeParse(keyRaw);
    if (!keyResult.success) {
      return null;
    }

    const valueRaw = line.slice(separatorIndex + 1).trim();
    parsedPayload[keyResult.data] = stripWrappingQuotes(valueRaw);
  }

  return Object.keys(parsedPayload).length > 0 ? parsedPayload : null;
}

async function resolveLocalConvex(
  record: Pick<CredentialRecord, "secretJson">,
): Promise<Result<CredentialPayload | null, Error>> {
  return Result.ok(coerceRecord(record.secretJson));
}

async function resolveWorkosVault(
  record: Pick<CredentialRecord, "secretJson">,
  readVaultObject: VaultObjectReader,
): Promise<Result<CredentialPayload | null, Error>> {
  const parsedReference = parseWorkosVaultReference(coerceRecord(record.secretJson));
  const objectId = parsedReference.objectId ?? "";

  if (!objectId) {
    return Result.err(
      new Error("Encrypted credential is missing its secure reference. Re-save this credential in the dashboard."),
    );
  }
  const apiKey = parsedReference.apiKey;

  const rawResult = await Result.tryPromise(async () => {
    return await readVaultObject({ objectId, apiKey });
  });
  if (rawResult.isErr()) {
    return Result.err(new Error(rawResult.error.message));
  }

  return Result.ok(parseSecretValue(rawResult.value));
}

const providers: Record<CredentialProvider, ProviderResolver> = {
  "local-convex": resolveLocalConvex,
  "workos-vault": resolveWorkosVault,
};

export async function resolveCredentialPayload(
  record: Pick<CredentialRecord, "provider" | "secretJson">,
  options?: { readVaultObject?: VaultObjectReader },
): Promise<CredentialPayload | null> {
  const resolved = await resolveCredentialPayloadResult(record, options);
  if (resolved.isErr()) {
    throw resolved.error;
  }

  return resolved.value;
}

export async function resolveCredentialPayloadResult(
  record: Pick<CredentialRecord, "provider" | "secretJson">,
  options?: { readVaultObject?: VaultObjectReader },
): Promise<Result<CredentialPayload | null, Error>> {
  const provider = record.provider;
  const resolver = providers[provider];
  if (!resolver) {
    return Result.err(new Error(`Unsupported credential provider: ${provider}`));
  }

  return await resolver(record, options?.readVaultObject ?? defaultReadVaultObject);
}
