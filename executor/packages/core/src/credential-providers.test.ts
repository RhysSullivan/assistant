import { expect, test } from "bun:test";
import { resolveCredentialPayload, resolveCredentialPayloadResult } from "./credential-providers";

test("local provider returns stored payload", async () => {
  const payload = await resolveCredentialPayload({
    provider: "local-convex",
    secretJson: { token: "local-token" },
  });

  expect(payload).toEqual({ token: "local-token" });
});

test("WorkOS Vault provider reads object and parses JSON", async () => {
  let capturedObjectId = "";
  const payload = await resolveCredentialPayload(
    {
      provider: "workos-vault",
      secretJson: { objectId: "secret_123" },
    },
    {
      readVaultObject: async ({ objectId }) => {
        capturedObjectId = objectId;
        return '{"token":"vault-token","headerName":"x-api-key"}';
      },
    },
  );

  expect(capturedObjectId).toBe("secret_123");
  expect(payload).toEqual({ token: "vault-token", headerName: "x-api-key" });
});

test("WorkOS Vault provider falls back to id key and raw token", async () => {
  const payload = await resolveCredentialPayload(
    {
      provider: "workos-vault",
      secretJson: { id: "secret_456" },
    },
    {
      readVaultObject: async ({ objectId }) => {
        expect(objectId).toBe("secret_456");
        return "ghp_raw_token";
      },
    },
  );

  expect(payload).toEqual({ token: "ghp_raw_token" });
});

test("WorkOS Vault provider parses env-style key/value payloads", async () => {
  const payload = await resolveCredentialPayload(
    {
      provider: "workos-vault",
      secretJson: { objectId: "secret_789" },
    },
    {
      readVaultObject: async ({ objectId }) => {
        expect(objectId).toBe("secret_789");
        return "TOKEN=vault-token\nHEADER_NAME=\"x-api-key\"";
      },
    },
  );

  expect(payload).toEqual({ TOKEN: "vault-token", HEADER_NAME: "x-api-key" });
});

test("WorkOS Vault provider gives actionable error on missing reference", async () => {
  await expect(
    resolveCredentialPayload({
      provider: "workos-vault",
      secretJson: {},
    }),
  ).rejects.toThrow("Re-save this credential");
});

test("resolveCredentialPayloadResult returns Err for missing WorkOS reference", async () => {
  const result = await resolveCredentialPayloadResult({
    provider: "workos-vault",
    secretJson: {},
  });

  expect(result.isErr()).toBe(true);
  if (result.isErr()) {
    expect(result.error.message).toContain("Re-save this credential");
  }
});
