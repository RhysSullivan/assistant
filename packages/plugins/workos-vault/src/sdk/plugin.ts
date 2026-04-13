import { Effect } from "effect";

import { definePlugin, type ExecutorPlugin } from "@executor/sdk";

import { WORKOS_VAULT_PROVIDER_KEY } from "./secret-store";

const PLUGIN_KEY = "workosVault";

export interface WorkOSVaultExtension {
  readonly providerKey: typeof WORKOS_VAULT_PROVIDER_KEY;
}

export const workosVaultPlugin = (): ExecutorPlugin<typeof PLUGIN_KEY, WorkOSVaultExtension> =>
  definePlugin({
    key: PLUGIN_KEY,
    init: (ctx) =>
      Effect.gen(function* () {
        const providers = yield* ctx.secrets.providers();
        if (!providers.includes(WORKOS_VAULT_PROVIDER_KEY)) {
          return yield* Effect.fail(
            new Error(
              `WorkOS Vault plugin requires the "${WORKOS_VAULT_PROVIDER_KEY}" secret store`,
            ),
          );
        }

        return {
          extension: {
            providerKey: WORKOS_VAULT_PROVIDER_KEY,
          },
        };
      }),
  });
