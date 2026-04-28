import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, FastCheck } from "effect";

import {
  WorkOSVaultClientError,
  makeConfiguredWorkOSVaultClient,
  type WorkOSVaultClient,
} from "./client";

const hasWorkOSDevCredentials =
  Boolean(process.env.WORKOS_API_KEY) && Boolean(process.env.WORKOS_CLIENT_ID);
const contractRunEnabled = process.env.WORKOS_VAULT_CONTRACT === "1";

const unwrapVaultError = (error: unknown): unknown =>
  error instanceof WorkOSVaultClientError ? error.cause : error;

const statusOf = (error: unknown): number | undefined => {
  const cause = unwrapVaultError(error);
  if (typeof cause !== "object" || cause === null || !("status" in cause)) {
    return undefined;
  }
  const status = Reflect.get(cause, "status");
  return typeof status === "number" ? status : undefined;
};

const messageOf = (error: unknown): string => {
  const cause = unwrapVaultError(error);
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String(Reflect.get(cause, "message"));
  }
  return String(cause);
};

const makeClient = (): Effect.Effect<WorkOSVaultClient, never> =>
  makeConfiguredWorkOSVaultClient({
    apiKey: process.env.WORKOS_API_KEY!,
    clientId: process.env.WORKOS_CLIENT_ID!,
  }).pipe(Effect.orDie);

const generatedName = (runId: string, candidate: string): string =>
  `executor-contract/${runId}/${candidate}`;

const candidateString = FastCheck.string({
  minLength: 0,
  maxLength: 512,
}).chain((value) =>
  FastCheck.constantFrom(
    value,
    `colon:${value}`,
    `slash/${value}`,
    `space ${value}`,
    `percent%${value}`,
    `query?${value}`,
    `hash#${value}`,
    `unicode-${value}-☃-🔥`,
    `${value}${"x".repeat(300)}`,
  ),
);

describe("WorkOS Vault contract", () => {
  it.effect(
    "discovers object-name constraints against the dev Vault API",
    () =>
      Effect.gen(function* () {
        if (!contractRunEnabled || !hasWorkOSDevCredentials) {
          console.warn(
            "[workos-vault contract] skipping: run `bun run test:contract:workos-vault` with WORKOS_API_KEY and WORKOS_CLIENT_ID",
          );
          return;
        }

        const client = yield* makeClient();
        const runId = `${Date.now()}-${crypto.randomUUID()}`;
        const accepted: string[] = [];
        const rejected: Array<{
          readonly name: string;
          readonly status: number | undefined;
          readonly message: string;
        }> = [];

        yield* Effect.promise(() =>
          FastCheck.assert(
            FastCheck.asyncProperty(candidateString, async (candidate) => {
              const name = generatedName(runId, candidate);
              const result = await Effect.runPromise(
                Effect.either(
                  client.createObject({
                    name,
                    value: "contract-test",
                    context: {
                      app: "executor",
                      contract_test_run_id: runId,
                    },
                  }),
                ),
              );

              if (Either.isRight(result)) {
                accepted.push(name);
                await Effect.runPromise(
                  client.deleteObject({ id: result.right.id }).pipe(Effect.ignore),
                );
                return true;
              }

              const status = statusOf(result.left);
              rejected.push({ name, status, message: messageOf(result.left) });

              // Contract-discovery failures are expected to be validation
              // style rejections. Anything else should stop the run.
              return status === 400 || status === 409;
            }),
            {
              numRuns: Number(process.env.WORKOS_VAULT_CONTRACT_RUNS ?? 40),
              seed:
                process.env.WORKOS_VAULT_CONTRACT_SEED === undefined
                  ? undefined
                  : Number(process.env.WORKOS_VAULT_CONTRACT_SEED),
            },
          ),
        );

        console.info(
          JSON.stringify(
            {
              runId,
              acceptedCount: accepted.length,
              rejectedCount: rejected.length,
              acceptedExamples: accepted.slice(0, 10),
              rejectedExamples: rejected.slice(0, 20),
            },
            null,
            2,
          ),
        );

        expect(accepted.length + rejected.length).toBeGreaterThan(0);
      }),
    60_000,
  );
});
