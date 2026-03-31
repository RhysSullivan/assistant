import { createHash } from "node:crypto";

import {
  ScopeIdSchema,
  type LocalInstallation,
} from "@executor/platform-sdk/schema";
import * as Effect from "effect/Effect";

import type { ResolvedLocalWorkspaceContext } from "./config";

const LOCAL_ACCOUNT_ID = ScopeIdSchema.make("acc_local_default");

const stableHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

const normalizeSlashPath = (value: string): string =>
  value.replaceAll("\\", "/");

const deriveWorkspaceId = (context: ResolvedLocalWorkspaceContext) =>
  ScopeIdSchema.make(
    `ws_local_${stableHash(normalizeSlashPath(context.workspaceRoot))}`,
  );

export const deriveLocalInstallation = (
  context: ResolvedLocalWorkspaceContext,
): LocalInstallation => ({
  actorScopeId: LOCAL_ACCOUNT_ID,
  scopeId: deriveWorkspaceId(context),
});

export const loadLocalInstallation = (
  context: ResolvedLocalWorkspaceContext,
): Effect.Effect<LocalInstallation, never> =>
  Effect.succeed(deriveLocalInstallation(context));

export const getOrProvisionLocalInstallation = (input: {
  context: ResolvedLocalWorkspaceContext;
}): Effect.Effect<LocalInstallation, never> =>
  loadLocalInstallation(input.context);
