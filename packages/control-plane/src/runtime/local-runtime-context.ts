import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { AccountId, OrganizationId, WorkspaceId } from "#schema";
import type {
  LoadedLocalExecutorConfig,
  ResolvedLocalWorkspaceContext,
} from "./local-config";

export type RuntimeLocalWorkspaceState = {
  context: ResolvedLocalWorkspaceContext;
  installation: {
    workspaceId: WorkspaceId;
    accountId: AccountId;
    organizationId: OrganizationId;
  };
  loadedConfig: LoadedLocalExecutorConfig;
};

export class RuntimeLocalWorkspaceService extends Context.Tag(
  "#runtime/RuntimeLocalWorkspaceService",
)<RuntimeLocalWorkspaceService, RuntimeLocalWorkspaceState>() {}

export const getRuntimeLocalWorkspaceOption = () =>
  Effect.contextWith((context) =>
    Context.getOption(context, RuntimeLocalWorkspaceService),
  ).pipe(
    Effect.map((option) => (Option.isSome(option) ? option.value : null)),
  ) as Effect.Effect<RuntimeLocalWorkspaceState | null, never, never>;

export const requireRuntimeLocalWorkspace = (workspaceId?: WorkspaceId) =>
  Effect.flatMap(getRuntimeLocalWorkspaceOption(), (runtimeLocalWorkspace) => {
    if (runtimeLocalWorkspace === null) {
      return Effect.fail(new Error("Runtime local workspace is unavailable"));
    }

    if (
      workspaceId !== undefined
      && runtimeLocalWorkspace.installation.workspaceId !== workspaceId
    ) {
      return Effect.fail(
        new Error(
          `Workspace ${workspaceId} is not the active local workspace ${runtimeLocalWorkspace.installation.workspaceId}`,
        ),
      );
    }

    return Effect.succeed(runtimeLocalWorkspace);
  });
