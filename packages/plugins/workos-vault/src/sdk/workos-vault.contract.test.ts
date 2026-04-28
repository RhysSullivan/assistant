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

const statusOf = (error: WorkOSVaultClientError): number | undefined =>
  error.status;

const messageOf = (error: WorkOSVaultClientError): string => error.message;

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

const contractSeed = (): number | undefined =>
  process.env.WORKOS_VAULT_CONTRACT_SEED === undefined
    ? undefined
    : Number(process.env.WORKOS_VAULT_CONTRACT_SEED);

const skipContractTest = Effect.sync(() =>
  console.warn(
    "[workos-vault contract] skipping: run `bun run test:contract:workos-vault` with WORKOS_API_KEY and WORKOS_CLIENT_ID",
  ),
);

describe("WorkOS Vault contract", () => {
  it.effect(
    "discovers object-name constraints against the dev Vault API",
    () =>
      !contractRunEnabled || !hasWorkOSDevCredentials
        ? skipContractTest
        : Effect.gen(function* () {
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

                  return Either.match(result, {
                    onRight: async (object) => {
                      accepted.push(name);
                      await Effect.runPromise(
                        client.deleteObject({ id: object.id }).pipe(Effect.ignore),
                      );
                      return true;
                    },
                    onLeft: (error) => {
                      const status = statusOf(error);
                      rejected.push({ name, status, message: messageOf(error) });

                      // Contract-discovery failures are expected to be validation
                      // style rejections. Anything else should stop the run.
                      return status === 400 || status === 409;
                    },
                  });
                }),
                {
                  numRuns: Number(process.env.WORKOS_VAULT_CONTRACT_RUNS ?? 40),
                  seed: contractSeed(),
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
