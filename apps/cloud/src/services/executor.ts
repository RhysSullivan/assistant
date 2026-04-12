// ---------------------------------------------------------------------------
// Cloud executor — stateless, per-request, from Postgres
// ---------------------------------------------------------------------------

import { Effect } from "effect";

import { createExecutor } from "@executor/sdk";
import { makePgConfig, makePgKv } from "@executor/storage-postgres";
import { DbService } from "./db";
import { createCloudRuntimePlugins } from "../server/plugin-registry";

// ---------------------------------------------------------------------------
// Create a fresh executor for an organization (stateless, per-request)
// ---------------------------------------------------------------------------

export const createOrgExecutor = (
  organizationId: string,
  organizationName: string,
  encryptionKey: string,
) =>
  Effect.gen(function* () {
    const db = yield* DbService;
    const kv = makePgKv(db, organizationId);
    const config = makePgConfig(db, {
      organizationId,
      organizationName,
      encryptionKey,
      plugins: createCloudRuntimePlugins(kv),
    });

    return yield* createExecutor(config);
  });
