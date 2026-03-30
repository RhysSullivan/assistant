import { join } from "node:path";

import {
  type Execution,
  type ExecutionInteraction,
  type ExecutionStep,
  ExecutionInteractionSchema,
  ExecutionSchema,
  ExecutionStepSchema,
  SecretMaterialSchema,
  type SecretMaterial,
  SecretStoreSchema,
  type SecretStore,
} from "@executor/platform-sdk/schema";
import * as Schema from "effect/Schema";

import type { ResolvedLocalWorkspaceContext } from "./config";
import { deriveLocalInstallation } from "./installation";

export const LOCAL_EXECUTOR_STATE_VERSION = 2 as const;
export const LOCAL_EXECUTOR_STATE_BASENAME = "executor-state.json";

export const SecretMaterialStoredDataRecordSchema = Schema.Struct({
  secretId: Schema.String,
  data: Schema.Unknown,
});

export type SecretMaterialStoredDataRecord =
  typeof SecretMaterialStoredDataRecordSchema.Type;

export const LocalExecutorStateSnapshotSchema = Schema.Struct({
  version: Schema.Literal(LOCAL_EXECUTOR_STATE_VERSION),
  secretStores: Schema.Array(SecretStoreSchema),
  secretMaterials: Schema.Array(SecretMaterialSchema),
  secretMaterialStoredData: Schema.Array(SecretMaterialStoredDataRecordSchema),
  executions: Schema.Array(ExecutionSchema),
  executionInteractions: Schema.Array(ExecutionInteractionSchema),
  executionSteps: Schema.Array(ExecutionStepSchema),
});

export type LocalExecutorStateSnapshot =
  typeof LocalExecutorStateSnapshotSchema.Type;

export const decodeLocalExecutorStateSnapshot = Schema.decodeUnknownSync(
  LocalExecutorStateSnapshotSchema,
  {
    onExcessProperty: "error",
  },
);

export const encodeLocalExecutorStateSnapshot = (
  state: LocalExecutorStateSnapshot,
): string => `${JSON.stringify(state, null, 2)}\n`;

export const defaultLocalExecutorStateSnapshot =
  (): LocalExecutorStateSnapshot => ({
    version: LOCAL_EXECUTOR_STATE_VERSION,
    secretStores: [],
    secretMaterials: [],
    secretMaterialStoredData: [],
    executions: [],
    executionInteractions: [],
    executionSteps: [],
  });

export const localExecutorStatePath = (
  context: ResolvedLocalWorkspaceContext,
): string =>
  join(
    context.homeStateDirectory,
    "workspaces",
    deriveLocalInstallation(context).scopeId,
    LOCAL_EXECUTOR_STATE_BASENAME,
  );

export type {
  Execution,
  ExecutionInteraction,
  ExecutionStep,
  SecretMaterial,
  SecretStore,
};
