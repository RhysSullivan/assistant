import { promises as fs } from "node:fs";
import { join } from "node:path";

import {
  PolicyIdSchema,
  SourceStatusSchema,
  TimestampMsSchema,
} from "#schema";
import * as Schema from "effect/Schema";

import type { ResolvedLocalWorkspaceContext } from "./local-config";

const WORKSPACE_STATE_BASENAME = "workspace-state.json";

const LocalWorkspaceSourceStateSchema = Schema.Struct({
  status: SourceStatusSchema,
  lastError: Schema.NullOr(Schema.String),
  sourceHash: Schema.NullOr(Schema.String),
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

const LocalWorkspacePolicyStateSchema = Schema.Struct({
  id: PolicyIdSchema,
  createdAt: TimestampMsSchema,
  updatedAt: TimestampMsSchema,
});

export const LocalWorkspaceStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  sources: Schema.Record({
    key: Schema.String,
    value: LocalWorkspaceSourceStateSchema,
  }),
  policies: Schema.Record({
    key: Schema.String,
    value: LocalWorkspacePolicyStateSchema,
  }),
});

export type LocalWorkspaceSourceState = typeof LocalWorkspaceSourceStateSchema.Type;
export type LocalWorkspacePolicyState = typeof LocalWorkspacePolicyStateSchema.Type;
export type LocalWorkspaceState = typeof LocalWorkspaceStateSchema.Type;

const decodeLocalWorkspaceState = Schema.decodeUnknownSync(LocalWorkspaceStateSchema);

const defaultLocalWorkspaceState = (): LocalWorkspaceState => ({
  version: 1,
  sources: {},
  policies: {},
});

export const localWorkspaceStatePath = (
  context: ResolvedLocalWorkspaceContext,
): string => join(context.stateDirectory, WORKSPACE_STATE_BASENAME);

export const loadLocalWorkspaceState = async (
  context: ResolvedLocalWorkspaceContext,
): Promise<LocalWorkspaceState> => {
  const path = localWorkspaceStatePath(context);

  try {
    const content = await fs.readFile(path, "utf8");
    return decodeLocalWorkspaceState(JSON.parse(content) as unknown);
  } catch (cause) {
    if (
      cause instanceof Error
      && ("code" in cause)
      && (cause as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return defaultLocalWorkspaceState();
    }

    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Invalid local workspace state at ${path}: ${message}`);
  }
};

export const writeLocalWorkspaceState = async (input: {
  context: ResolvedLocalWorkspaceContext;
  state: LocalWorkspaceState;
}): Promise<void> => {
  await fs.mkdir(input.context.stateDirectory, { recursive: true });
  await fs.writeFile(
    localWorkspaceStatePath(input.context),
    `${JSON.stringify(input.state, null, 2)}\n`,
    "utf8",
  );
};
