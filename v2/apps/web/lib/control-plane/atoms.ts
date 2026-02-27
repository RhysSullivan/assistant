import { Atom, Result } from "@effect-atom/atom";
import type { Source, WorkspaceId } from "@executor-v2/schema";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

import { controlPlaneClient } from "./client";

type SourcesResult = Result.Result<ReadonlyArray<Source>, unknown>;

const emptySources: ReadonlyArray<Source> = [];

export const sourcesResultDisabled = Atom.make(
  Result.initial<ReadonlyArray<Source>, unknown>(),
);

export const sourcesResultByWorkspace = Atom.family(
  (workspaceId: WorkspaceId): Atom.Atom<SourcesResult> =>
    controlPlaneClient.query("sources", "list", {
      path: {
        workspaceId,
      },
    }) as Atom.Atom<SourcesResult>,
);

export const upsertSource = controlPlaneClient.mutation("sources", "upsert");
export const removeSource = controlPlaneClient.mutation("sources", "remove");

export type SourcesState =
  | {
      state: "loading";
      items: ReadonlyArray<Source>;
      message: null;
    }
  | {
      state: "error";
      items: ReadonlyArray<Source>;
      message: string;
    }
  | {
      state: "ready" | "refreshing";
      items: ReadonlyArray<Source>;
      message: null;
    };

export const sourcesLoading = Atom.make<SourcesState>({
  state: "loading",
  items: emptySources,
  message: null,
});

export const sourcesByWorkspace = Atom.family((workspaceId: WorkspaceId) =>
  Atom.make((get): SourcesState => {
    const result = get(sourcesResultByWorkspace(workspaceId));

    return Result.match(result, {
      onInitial: () => ({
        state: "loading",
        items: emptySources,
        message: null,
      }),
      onFailure: (failure) => ({
        state: "error",
        items: Option.getOrElse(Result.value(result), () => emptySources),
        message: Cause.pretty(failure.cause),
      }),
      onSuccess: (success) => ({
        state: success.waiting ? "refreshing" : "ready",
        items: success.value,
        message: null,
      }),
    });
  }),
);
