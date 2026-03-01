import { Atom, Result } from "@effect-atom/atom";
import {
  FetchHttpClient,
  HttpApiClient,
  HttpApiError,
  HttpClientError,
} from "@effect/platform";
import type {
  Source,
  SourceId,
  WorkspaceId,
} from "@executor-v2/schema";
import * as Effect from "effect/Effect";
import * as ParseResult from "effect/ParseResult";

import {
  ControlPlaneApi,
  type ControlPlaneBadRequestError,
  type ControlPlaneStorageError,
  type RemoveSourceResult,
  type UpsertSourcePayload,
} from "./api";

export type ControlPlaneClientOptions = {
  baseUrl: string;
};

export type ControlPlaneClientError =
  | ControlPlaneBadRequestError
  | ControlPlaneStorageError
  | HttpApiError.HttpApiDecodeError
  | HttpClientError.HttpClientError
  | ParseResult.ParseError;

export type ListSourcesRequest = {
  workspaceId: WorkspaceId;
};

export type UpsertSourceRequest = {
  workspaceId: WorkspaceId;
  payload: UpsertSourcePayload;
};

export type RemoveSourceRequest = {
  workspaceId: WorkspaceId;
  sourceId: SourceId;
};

export type ControlPlaneReadOptions = {
  enabled?: boolean;
};

export const makeControlPlaneClient = (options: ControlPlaneClientOptions) =>
  HttpApiClient.make(ControlPlaneApi, {
    baseUrl: options.baseUrl,
  });

const isReadEnabled = (options?: ControlPlaneReadOptions): boolean =>
  options?.enabled ?? true;

const makeDisabledResultAtom = <Success, Error>() =>
  Atom.make(Result.initial<Success, Error>());

export const createControlPlaneAtomClient = (
  options: ControlPlaneClientOptions,
) => {
  const baseLayer = FetchHttpClient.layer;
  const runtime = Atom.runtime(baseLayer);

  const listSourcesEffect = (
    input: ListSourcesRequest,
  ): Effect.Effect<ReadonlyArray<Source>, ControlPlaneClientError, never> =>
    Effect.gen(function* () {
      const client = yield* makeControlPlaneClient(options);
      return yield* client.sources.list({
        path: {
          workspaceId: input.workspaceId,
        },
      });
    }).pipe(Effect.provide(baseLayer));

  const upsertSourceEffect = (
    input: UpsertSourceRequest,
  ): Effect.Effect<Source, ControlPlaneClientError, never> =>
    Effect.gen(function* () {
      const client = yield* makeControlPlaneClient(options);
      return yield* client.sources.upsert({
        path: {
          workspaceId: input.workspaceId,
        },
        payload: input.payload,
      });
    }).pipe(Effect.provide(baseLayer));

  const removeSourceEffect = (
    input: RemoveSourceRequest,
  ): Effect.Effect<RemoveSourceResult, ControlPlaneClientError, never> =>
    Effect.gen(function* () {
      const client = yield* makeControlPlaneClient(options);
      return yield* client.sources.remove({
        path: {
          workspaceId: input.workspaceId,
          sourceId: input.sourceId,
        },
      });
    }).pipe(Effect.provide(baseLayer));

  const listSourcesFamily = Atom.family((workspaceId: WorkspaceId) =>
    runtime.atom(
      listSourcesEffect({
        workspaceId,
      }),
    ),
  );

  const listDisabledAtom = makeDisabledResultAtom<
    ReadonlyArray<Source>,
    ControlPlaneClientError
  >();

  const upsertSourceMutate = runtime.fn<UpsertSourceRequest>()(
    Effect.fnUntraced(function* (input) {
      return yield* upsertSourceEffect(input);
    }),
  );

  const removeSourceMutate = runtime.fn<RemoveSourceRequest>()(
    Effect.fnUntraced(function* (input) {
      return yield* removeSourceEffect(input);
    }),
  );

  return {
    runtime,
    sources: {
      list: {
        query: (input: ListSourcesRequest, readOptions?: ControlPlaneReadOptions) =>
          isReadEnabled(readOptions)
            ? listSourcesFamily(input.workspaceId)
            : listDisabledAtom,
        queryEffect: listSourcesEffect,
        queryPromise: (input: ListSourcesRequest) =>
          Effect.runPromise(listSourcesEffect(input)),
      },
      upsert: {
        mutate: upsertSourceMutate,
        mutateEffect: upsertSourceEffect,
        mutatePromise: (input: UpsertSourceRequest) =>
          Effect.runPromise(upsertSourceEffect(input)),
      },
      remove: {
        mutate: removeSourceMutate,
        mutateEffect: removeSourceEffect,
        mutatePromise: (input: RemoveSourceRequest) =>
          Effect.runPromise(removeSourceEffect(input)),
      },
    },
  };
};
