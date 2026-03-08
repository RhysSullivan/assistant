import { Atom, Result } from "@effect-atom/atom";
import type * as Registry from "@effect-atom/atom/Registry";
import { RegistryContext, RegistryProvider, useAtomValue } from "@effect-atom/atom-react";
import type {
  CreateSourcePayload,
  LocalInstallation,
  Source,
  SourceInspection,
  SourceInspectionDiscoverResult,
  SourceInspectionToolDetail,
  UpdateSourcePayload,
} from "@executor-v3/control-plane";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as React from "react";

const DEFAULT_EXECUTOR_API_BASE_URL = "http://127.0.0.1:8788";
const ACCOUNT_HEADER = "x-executor-account-id";
const PLACEHOLDER_WORKSPACE_ID = "ws_placeholder" as Source["workspaceId"];
const PLACEHOLDER_ACCOUNT_ID = "acc_placeholder";
const PLACEHOLDER_SOURCE_ID = "src_placeholder" as Source["id"];

type SourceMutationState<T> = {
  status: "idle" | "pending" | "success" | "error";
  data: T | null;
  error: Error | null;
};

export type SourceRemoveResult = {
  removed: boolean;
};

type AtomKeyPart = string | number | boolean | null | undefined;

type SourcesKeyParts = readonly [boolean, Source["workspaceId"], string];
type SourceKeyParts = readonly [boolean, Source["workspaceId"], string, Source["id"]];
type SourceToolDetailKeyParts = readonly [
  boolean,
  Source["workspaceId"],
  string,
  Source["id"],
  string | null,
];
type SourceDiscoveryKeyParts = readonly [
  boolean,
  Source["workspaceId"],
  string,
  Source["id"],
  string,
  number | null,
];

type InvalidationTarget = {
  workspaceId?: Source["workspaceId"];
  accountId?: string;
  sourceId?: Source["id"];
};

type ActiveQueryCollections = {
  sourceLists: Set<string>;
  sources: Set<string>;
  inspections: Set<string>;
  toolDetails: Set<string>;
  discoveries: Set<string>;
};

type ExecutorQueryContextValue = {
  registry: Registry.Registry;
  activeQueries: ActiveQueryCollections;
  invalidateQueries: (target?: InvalidationTarget) => void;
};

type MutationExecutionContext = {
  workspaceId: Source["workspaceId"];
  accountId: string;
  registry: Registry.Registry;
  invalidateQueries: (target?: InvalidationTarget) => void;
};

type MutationOptions<TInput, TOutput> = {
  optimisticUpdate?: (context: MutationExecutionContext, payload: TInput) => void | (() => void);
  onSuccess?: (context: MutationExecutionContext, payload: TInput, data: TOutput) => void;
};

type InternalNode<A> = {
  setValue: (value: A) => void;
  valueOption?: () => { _tag: "Some"; value: A } | { _tag: string };
};

let apiBaseUrl =
  typeof window !== "undefined" && typeof window.location?.origin === "string"
    ? window.location.origin
    : DEFAULT_EXECUTOR_API_BASE_URL;

const ExecutorQueryContext = React.createContext<ExecutorQueryContextValue | null>(null);

const encodeAtomKey = (parts: ReadonlyArray<AtomKeyPart>): string => JSON.stringify(parts);

const decodeAtomKey = <T extends ReadonlyArray<AtomKeyPart>>(key: string): T => JSON.parse(key) as T;

const encodeSourcesKey = (
  enabled: boolean,
  workspaceId: Source["workspaceId"],
  accountId: string,
): string => encodeAtomKey([enabled, workspaceId, accountId] satisfies SourcesKeyParts);

const encodeSourceKey = (
  enabled: boolean,
  workspaceId: Source["workspaceId"],
  accountId: string,
  sourceId: Source["id"],
): string => encodeAtomKey([enabled, workspaceId, accountId, sourceId] satisfies SourceKeyParts);

const encodeToolDetailKey = (
  enabled: boolean,
  workspaceId: Source["workspaceId"],
  accountId: string,
  sourceId: Source["id"],
  toolPath: string | null,
): string =>
  encodeAtomKey([enabled, workspaceId, accountId, sourceId, toolPath] satisfies SourceToolDetailKeyParts);

const encodeDiscoveryKey = (
  enabled: boolean,
  workspaceId: Source["workspaceId"],
  accountId: string,
  sourceId: Source["id"],
  query: string,
  limit: number | null,
): string =>
  encodeAtomKey([enabled, workspaceId, accountId, sourceId, query, limit] satisfies SourceDiscoveryKeyParts);

const causeMessage = (cause: Cause.Cause<unknown>): Error =>
  new Error(Cause.pretty(cause));

const requestJson = async <A>(input: {
  path: string;
  accountId?: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  payload?: unknown;
}): Promise<A> => {
  const response = await fetch(new URL(input.path, apiBaseUrl), {
    method: input.method ?? "GET",
    headers: {
      ...(input.accountId ? { [ACCOUNT_HEADER]: input.accountId } : {}),
      ...(input.payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(input.payload !== undefined ? { body: JSON.stringify(input.payload) } : {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<A>;
};

const localInstallationAtom = Atom.make(
  Effect.promise(() => requestJson<LocalInstallation>({ path: "/v1/local/installation" })),
).pipe(Atom.keepAlive);

const sourcesAtom = Atom.family((key: string) => {
  const [enabled, workspaceId, accountId] = decodeAtomKey<SourcesKeyParts>(key);

  return Atom.make(
    enabled
      ? Effect.promise(() =>
          requestJson<ReadonlyArray<Source>>({
            path: `/v1/workspaces/${workspaceId}/sources`,
            accountId,
          }),
        )
      : Effect.never,
  ).pipe(Atom.keepAlive);
});

const sourceAtom = Atom.family((key: string) => {
  const [enabled, workspaceId, accountId, sourceId] = decodeAtomKey<SourceKeyParts>(key);

  return Atom.make(
    enabled
      ? Effect.promise(() =>
          requestJson<Source>({
            path: `/v1/workspaces/${workspaceId}/sources/${sourceId}`,
            accountId,
          }),
        )
      : Effect.never,
  ).pipe(Atom.keepAlive);
});

const sourceInspectionAtom = Atom.family((key: string) => {
  const [enabled, workspaceId, accountId, sourceId] = decodeAtomKey<SourceKeyParts>(key);

  return Atom.make(
    enabled
      ? Effect.promise(() =>
          requestJson<SourceInspection>({
            path: `/v1/workspaces/${workspaceId}/sources/${sourceId}/inspection`,
            accountId,
          }),
        )
      : Effect.never,
  ).pipe(Atom.keepAlive);
});

const sourceInspectionToolAtom = Atom.family((key: string) => {
  const [enabled, workspaceId, accountId, sourceId, toolPath] = decodeAtomKey<SourceToolDetailKeyParts>(key);

  return Atom.make(
    enabled && toolPath
      ? Effect.promise(() =>
          requestJson<SourceInspectionToolDetail>({
            path: `/v1/workspaces/${workspaceId}/sources/${sourceId}/tools/${encodeURIComponent(toolPath)}/inspection`,
            accountId,
          }),
        )
      : Effect.succeed<SourceInspectionToolDetail | null>(null),
  ).pipe(Atom.keepAlive);
});

const sourceDiscoveryAtom = Atom.family((key: string) => {
  const [enabled, workspaceId, accountId, sourceId, query, limit] = decodeAtomKey<SourceDiscoveryKeyParts>(key);

  return Atom.make(
    !enabled
      ? Effect.never
      : query.trim().length === 0
        ? Effect.succeed<SourceInspectionDiscoverResult>({
            query: "",
            queryTokens: [],
            bestPath: null,
            total: 0,
            results: [],
          })
        : Effect.promise(() =>
            requestJson<SourceInspectionDiscoverResult>({
              path: `/v1/workspaces/${workspaceId}/sources/${sourceId}/inspection/discover`,
              accountId,
              method: "POST",
              payload: {
                query,
                ...(limit !== null ? { limit } : {}),
              },
            }),
          ),
  ).pipe(Atom.keepAlive);
});

export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: T };

type WorkspaceContext = {
  installation: LocalInstallation;
  workspaceId: Source["workspaceId"];
  accountId: string;
};

const toLoadable = <T>(result: Result.Result<T, Error>): Loadable<T> => {
  if (Result.isSuccess(result)) {
    return {
      status: "ready",
      data: result.value,
    };
  }

  if (Result.isFailure(result)) {
    return {
      status: "error",
      error: causeMessage(result.cause),
    };
  }

  return {
    status: "loading",
  };
};

const pendingLoadable = <T>(workspace: Loadable<WorkspaceContext>): Loadable<T> => {
  if (workspace.status === "loading") {
    return { status: "loading" };
  }

  if (workspace.status === "error") {
    return { status: "error", error: workspace.error };
  }

  throw new Error("Expected workspace loadable to be pending or errored");
};

const useLoadableAtom = <T>(atom: Atom.Atom<Result.Result<T, Error>>): Loadable<T> => {
  const result = useAtomValue(atom);
  return React.useMemo(() => toLoadable(result), [result]);
};

const useWorkspaceContext = (): Loadable<WorkspaceContext> => {
  const installation = useLoadableAtom(localInstallationAtom);

  return React.useMemo(() => {
    if (installation.status !== "ready") {
      return installation;
    }

    return {
      status: "ready",
      data: {
        installation: installation.data,
        workspaceId: installation.data.workspaceId,
        accountId: installation.data.accountId,
      },
    } satisfies Loadable<WorkspaceContext>;
  }, [installation]);
};

const useWorkspaceRequestContext = () => {
  const workspace = useWorkspaceContext();
  const enabled = workspace.status === "ready";

  const workspaceId = enabled
    ? workspace.data.workspaceId
    : PLACEHOLDER_WORKSPACE_ID;
  const accountId = enabled
    ? workspace.data.accountId
    : PLACEHOLDER_ACCOUNT_ID;

  return React.useMemo(
    () => ({
      workspace,
      enabled,
      workspaceId,
      accountId,
    }),
    [accountId, enabled, workspace, workspaceId],
  );
};

const getCachedAtomValue = <A>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, Error>>,
): A | undefined => {
  const node = (registry.getNodes().get(atom) ?? null) as InternalNode<Result.Result<A, Error>> | null;
  if (node === null || typeof node.valueOption !== "function") {
    return undefined;
  }

  const option = node.valueOption();
  if (option._tag !== "Some") {
    return undefined;
  }

  const result = option as { _tag: "Some"; value: Result.Result<A, Error> };
  if (!Result.isSuccess(result.value)) {
    return undefined;
  }

  return result.value.value;
};

const setCachedAtomValue = <A>(
  registry: Registry.Registry,
  atom: Atom.Atom<Result.Result<A, Error>>,
  value: A,
): void => {
  const ensureNode = (registry as {
    ensureNode?: (atom: Atom.Atom<Result.Result<A, Error>>) => InternalNode<Result.Result<A, Error>>;
  }).ensureNode;
  if (typeof ensureNode !== "function") {
    return;
  }

  ensureNode.call(registry, atom).setValue(Result.success(value));
};

const createActiveQueryCollections = (): ActiveQueryCollections => ({
  sourceLists: new Set(),
  sources: new Set(),
  inspections: new Set(),
  toolDetails: new Set(),
  discoveries: new Set(),
});

const targetMatches = (
  target: InvalidationTarget | undefined,
  workspaceId: Source["workspaceId"],
  accountId: string,
  sourceId?: Source["id"],
): boolean => {
  if (target?.workspaceId !== undefined && target.workspaceId !== workspaceId) {
    return false;
  }
  if (target?.accountId !== undefined && target.accountId !== accountId) {
    return false;
  }
  if (target?.sourceId !== undefined && target.sourceId !== sourceId) {
    return false;
  }
  return true;
};

const invalidateTrackedQueries = (
  registry: Registry.Registry,
  activeQueries: ActiveQueryCollections,
  target?: InvalidationTarget,
): void => {
  activeQueries.sourceLists.forEach((key) => {
    const [enabled, workspaceId, accountId] = decodeAtomKey<SourcesKeyParts>(key);
    if (enabled && targetMatches(target, workspaceId, accountId)) {
      registry.refresh(sourcesAtom(key));
    }
  });

  activeQueries.sources.forEach((key) => {
    const [enabled, workspaceId, accountId, sourceId] = decodeAtomKey<SourceKeyParts>(key);
    if (enabled && targetMatches(target, workspaceId, accountId, sourceId)) {
      registry.refresh(sourceAtom(key));
    }
  });

  activeQueries.inspections.forEach((key) => {
    const [enabled, workspaceId, accountId, sourceId] = decodeAtomKey<SourceKeyParts>(key);
    if (enabled && targetMatches(target, workspaceId, accountId, sourceId)) {
      registry.refresh(sourceInspectionAtom(key));
    }
  });

  activeQueries.toolDetails.forEach((key) => {
    const [enabled, workspaceId, accountId, sourceId] = decodeAtomKey<SourceToolDetailKeyParts>(key);
    if (enabled && targetMatches(target, workspaceId, accountId, sourceId)) {
      registry.refresh(sourceInspectionToolAtom(key));
    }
  });

  activeQueries.discoveries.forEach((key) => {
    const [enabled, workspaceId, accountId, sourceId] = decodeAtomKey<SourceDiscoveryKeyParts>(key);
    if (enabled && targetMatches(target, workspaceId, accountId, sourceId)) {
      registry.refresh(sourceDiscoveryAtom(key));
    }
  });
};

const useExecutorQueryContext = (): ExecutorQueryContextValue => {
  const context = React.useContext(ExecutorQueryContext);
  if (context === null) {
    throw new Error("ExecutorReactProvider is missing from the React tree");
  }
  return context;
};

const useTrackActiveKey = (
  collection: keyof ActiveQueryCollections,
  key: string,
  enabled: boolean,
): void => {
  const { activeQueries } = useExecutorQueryContext();

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    const bucket = activeQueries[collection];
    bucket.add(key);
    return () => {
      bucket.delete(key);
    };
  }, [activeQueries, collection, enabled, key]);
};

const upsertSourceInList = (
  sources: ReadonlyArray<Source>,
  nextSource: Source,
): ReadonlyArray<Source> => {
  const index = sources.findIndex((source) => source.id === nextSource.id);
  if (index === -1) {
    return [nextSource, ...sources];
  }

  const next = sources.slice();
  next[index] = nextSource;
  return next;
};

const removeSourceFromList = (
  sources: ReadonlyArray<Source>,
  sourceId: Source["id"],
): ReadonlyArray<Source> => sources.filter((source) => source.id !== sourceId);

const createOptimisticSource = (input: {
  workspaceId: Source["workspaceId"];
  payload: CreateSourcePayload;
}): Source => {
  const now = Date.now();

  return {
    id: `src_optimistic_${crypto.randomUUID()}` as Source["id"],
    workspaceId: input.workspaceId,
    name: input.payload.name,
    kind: input.payload.kind,
    endpoint: input.payload.endpoint,
    status: input.payload.status ?? "draft",
    enabled: input.payload.enabled ?? true,
    namespace: input.payload.namespace ?? null,
    transport: input.payload.transport ?? null,
    queryParams: input.payload.queryParams ?? null,
    headers: input.payload.headers ?? null,
    specUrl: input.payload.specUrl ?? null,
    defaultHeaders: input.payload.defaultHeaders ?? null,
    auth: input.payload.auth ?? { kind: "none" },
    sourceHash: input.payload.sourceHash ?? null,
    lastError: input.payload.lastError ?? null,
    createdAt: now,
    updatedAt: now,
  };
};

const applyUpdatePayloadToSource = (source: Source, payload: UpdateSourcePayload): Source => ({
  ...source,
  name: payload.name ?? source.name,
  kind: payload.kind ?? source.kind,
  endpoint: payload.endpoint ?? source.endpoint,
  status: payload.status ?? source.status,
  enabled: payload.enabled ?? source.enabled,
  namespace: payload.namespace !== undefined ? payload.namespace : source.namespace,
  transport: payload.transport !== undefined ? payload.transport : source.transport,
  queryParams: payload.queryParams !== undefined ? payload.queryParams : source.queryParams,
  headers: payload.headers !== undefined ? payload.headers : source.headers,
  specUrl: payload.specUrl !== undefined ? payload.specUrl : source.specUrl,
  defaultHeaders: payload.defaultHeaders !== undefined ? payload.defaultHeaders : source.defaultHeaders,
  auth: payload.auth !== undefined ? payload.auth : source.auth,
  sourceHash: payload.sourceHash !== undefined ? payload.sourceHash : source.sourceHash,
  lastError: payload.lastError !== undefined ? payload.lastError : source.lastError,
  updatedAt: Date.now(),
});

const useSourceMutation = <TInput, TOutput>(
  execute: (input: {
    workspaceId: Source["workspaceId"];
    accountId: string;
    payload: TInput;
  }) => Promise<TOutput>,
  options?: MutationOptions<TInput, TOutput>,
) => {
  const workspace = useWorkspaceRequestContext();
  const { registry, invalidateQueries } = useExecutorQueryContext();
  const [state, setState] = React.useState<SourceMutationState<TOutput>>({
    status: "idle",
    data: null,
    error: null,
  });

  const mutateAsync = React.useCallback(async (payload: TInput) => {
    if (!workspace.enabled) {
      const error = new Error("Executor workspace context is not ready");
      setState({ status: "error", data: null, error });
      throw error;
    }

    const executionContext: MutationExecutionContext = {
      workspaceId: workspace.workspaceId,
      accountId: workspace.accountId,
      registry,
      invalidateQueries,
    };

    setState((current) => ({
      status: "pending",
      data: current.data,
      error: null,
    }));

    const rollback = options?.optimisticUpdate?.(executionContext, payload);

    try {
      const data = await execute({
        workspaceId: workspace.workspaceId,
        accountId: workspace.accountId,
        payload,
      });
      options?.onSuccess?.(executionContext, payload, data);
      setState({ status: "success", data, error: null });
      return data;
    } catch (cause) {
      rollback?.();
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setState({ status: "error", data: null, error });
      throw error;
    }
  }, [execute, invalidateQueries, options, registry, workspace.accountId, workspace.enabled, workspace.workspaceId]);

  const reset = React.useCallback(() => {
    setState({ status: "idle", data: null, error: null });
  }, []);

  return React.useMemo(
    () => ({
      ...state,
      mutateAsync,
      reset,
    }),
    [mutateAsync, reset, state],
  );
};

const ExecutorReactProviderInner = (props: React.PropsWithChildren) => {
  const registry = React.useContext(RegistryContext);
  const activeQueries = React.useMemo(createActiveQueryCollections, []);
  const invalidateQueries = React.useCallback((target?: InvalidationTarget) => {
    invalidateTrackedQueries(registry, activeQueries, target);
  }, [activeQueries, registry]);

  const value = React.useMemo<ExecutorQueryContextValue>(() => ({
    registry,
    activeQueries,
    invalidateQueries,
  }), [activeQueries, invalidateQueries, registry]);

  return React.createElement(ExecutorQueryContext.Provider, { value }, props.children);
};

export const setExecutorApiBaseUrl = (baseUrl: string): void => {
  apiBaseUrl = baseUrl;
};

export const ExecutorReactProvider = (props: React.PropsWithChildren) =>
  React.createElement(
    RegistryProvider,
    null,
    React.createElement(ExecutorReactProviderInner, null, props.children),
  );

export const useInvalidateExecutorQueries = (): (() => void) => {
  const { invalidateQueries } = useExecutorQueryContext();
  return React.useCallback(() => {
    invalidateQueries();
  }, [invalidateQueries]);
};

export const useLocalInstallation = (): Loadable<LocalInstallation> =>
  useLoadableAtom(localInstallationAtom);

export const useSources = (): Loadable<ReadonlyArray<Source>> => {
  const workspace = useWorkspaceRequestContext();
  const key = encodeSourcesKey(workspace.enabled, workspace.workspaceId, workspace.accountId);
  useTrackActiveKey("sourceLists", key, workspace.enabled);
  const sources = useLoadableAtom(sourcesAtom(key));

  return workspace.enabled ? sources : pendingLoadable(workspace.workspace);
};

export const useSource = (sourceId: string): Loadable<Source> => {
  const workspace = useWorkspaceRequestContext();
  const requestedSourceId = workspace.enabled
    ? (sourceId as Source["id"])
    : PLACEHOLDER_SOURCE_ID;
  const key = encodeSourceKey(
    workspace.enabled,
    workspace.workspaceId,
    workspace.accountId,
    requestedSourceId,
  );
  useTrackActiveKey("sources", key, workspace.enabled);
  const source = useLoadableAtom(sourceAtom(key));

  return workspace.enabled ? source : pendingLoadable(workspace.workspace);
};

export const useSourceInspection = (sourceId: string): Loadable<SourceInspection> => {
  const workspace = useWorkspaceRequestContext();
  const requestedSourceId = workspace.enabled
    ? (sourceId as Source["id"])
    : PLACEHOLDER_SOURCE_ID;
  const key = encodeSourceKey(
    workspace.enabled,
    workspace.workspaceId,
    workspace.accountId,
    requestedSourceId,
  );
  useTrackActiveKey("inspections", key, workspace.enabled);
  const inspection = useLoadableAtom(sourceInspectionAtom(key));

  return workspace.enabled ? inspection : pendingLoadable(workspace.workspace);
};

export const useSourceToolDetail = (
  sourceId: string,
  toolPath: string | null,
): Loadable<SourceInspectionToolDetail | null> => {
  const workspace = useWorkspaceRequestContext();
  const requestedSourceId = workspace.enabled
    ? (sourceId as Source["id"])
    : PLACEHOLDER_SOURCE_ID;
  const key = encodeToolDetailKey(
    workspace.enabled,
    workspace.workspaceId,
    workspace.accountId,
    requestedSourceId,
    toolPath,
  );
  useTrackActiveKey("toolDetails", key, workspace.enabled && toolPath !== null);
  const detail = useLoadableAtom(sourceInspectionToolAtom(key));

  return workspace.enabled ? detail : pendingLoadable(workspace.workspace);
};

export const useSourceDiscovery = (input: {
  sourceId: string;
  query: string;
  limit?: number;
}): Loadable<SourceInspectionDiscoverResult> => {
  const workspace = useWorkspaceRequestContext();
  const requestedSourceId = workspace.enabled
    ? (input.sourceId as Source["id"])
    : PLACEHOLDER_SOURCE_ID;
  const key = encodeDiscoveryKey(
    workspace.enabled,
    workspace.workspaceId,
    workspace.accountId,
    requestedSourceId,
    input.query,
    input.limit ?? null,
  );
  useTrackActiveKey("discoveries", key, workspace.enabled);
  const results = useLoadableAtom(sourceDiscoveryAtom(key));

  return workspace.enabled ? results : pendingLoadable(workspace.workspace);
};

export const usePrefetchToolDetail = () => {
  const registry = React.useContext(RegistryContext);
  const workspace = useWorkspaceRequestContext();

  return React.useCallback(
    (sourceId: string, toolPath: string): (() => void) => {
      if (!workspace.enabled) return () => {};
      const requestedSourceId = sourceId as Source["id"];
      const atom = sourceInspectionToolAtom(
        encodeToolDetailKey(
          workspace.enabled,
          workspace.workspaceId,
          workspace.accountId,
          requestedSourceId,
          toolPath,
        ),
      );
      return registry.mount(atom);
    },
    [registry, workspace.accountId, workspace.enabled, workspace.workspaceId],
  );
};

export const useCreateSource = () =>
  useSourceMutation<CreateSourcePayload, Source>(
    React.useCallback(
      ({ workspaceId, accountId, payload }) =>
        requestJson<Source>({
          path: `/v1/workspaces/${workspaceId}/sources`,
          accountId,
          method: "POST",
          payload,
        }),
      [],
    ),
    {
      optimisticUpdate: (context, payload) => {
        const listAtom = sourcesAtom(encodeSourcesKey(true, context.workspaceId, context.accountId));
        const previousList = getCachedAtomValue(context.registry, listAtom);
        if (previousList === undefined) {
          return;
        }

        const optimisticSource = createOptimisticSource({
          workspaceId: context.workspaceId,
          payload,
        });
        setCachedAtomValue(context.registry, listAtom, [optimisticSource, ...previousList]);
        return () => {
          setCachedAtomValue(context.registry, listAtom, previousList);
        };
      },
      onSuccess: (context, _payload, source) => {
        const listAtom = sourcesAtom(encodeSourcesKey(true, context.workspaceId, context.accountId));
        const currentList = getCachedAtomValue(context.registry, listAtom);
        if (currentList !== undefined) {
          setCachedAtomValue(context.registry, listAtom, upsertSourceInList(currentList, source));
        }

        setCachedAtomValue(
          context.registry,
          sourceAtom(encodeSourceKey(true, context.workspaceId, context.accountId, source.id)),
          source,
        );
        context.invalidateQueries({
          workspaceId: context.workspaceId,
          accountId: context.accountId,
        });
      },
    },
  );

export const useUpdateSource = () =>
  useSourceMutation<{ sourceId: Source["id"]; payload: UpdateSourcePayload }, Source>(
    React.useCallback(
      ({ workspaceId, accountId, payload }) =>
        requestJson<Source>({
          path: `/v1/workspaces/${workspaceId}/sources/${payload.sourceId}`,
          accountId,
          method: "PATCH",
          payload: payload.payload,
        }),
      [],
    ),
    {
      optimisticUpdate: (context, input) => {
        const listAtom = sourcesAtom(encodeSourcesKey(true, context.workspaceId, context.accountId));
        const detailAtom = sourceAtom(encodeSourceKey(true, context.workspaceId, context.accountId, input.sourceId));
        const previousList = getCachedAtomValue(context.registry, listAtom);
        const previousSource = getCachedAtomValue(context.registry, detailAtom)
          ?? previousList?.find((source) => source.id === input.sourceId);
        if (previousSource === undefined) {
          return;
        }

        const optimisticSource = applyUpdatePayloadToSource(previousSource, input.payload);
        if (previousList !== undefined) {
          setCachedAtomValue(context.registry, listAtom, upsertSourceInList(previousList, optimisticSource));
        }
        setCachedAtomValue(context.registry, detailAtom, optimisticSource);

        return () => {
          if (previousList !== undefined) {
            setCachedAtomValue(context.registry, listAtom, previousList);
          }
          setCachedAtomValue(context.registry, detailAtom, previousSource);
        };
      },
      onSuccess: (context, input, source) => {
        const listAtom = sourcesAtom(encodeSourcesKey(true, context.workspaceId, context.accountId));
        const detailAtom = sourceAtom(encodeSourceKey(true, context.workspaceId, context.accountId, input.sourceId));
        const currentList = getCachedAtomValue(context.registry, listAtom);
        if (currentList !== undefined) {
          setCachedAtomValue(context.registry, listAtom, upsertSourceInList(currentList, source));
        }
        setCachedAtomValue(context.registry, detailAtom, source);
        context.invalidateQueries({
          workspaceId: context.workspaceId,
          accountId: context.accountId,
          sourceId: input.sourceId,
        });
      },
    },
  );

export const useRemoveSource = () =>
  useSourceMutation<Source["id"], SourceRemoveResult>(
    React.useCallback(
      ({ workspaceId, accountId, payload }) =>
        requestJson<SourceRemoveResult>({
          path: `/v1/workspaces/${workspaceId}/sources/${payload}`,
          accountId,
          method: "DELETE",
        }),
      [],
    ),
    {
      optimisticUpdate: (context, sourceId) => {
        const listAtom = sourcesAtom(encodeSourcesKey(true, context.workspaceId, context.accountId));
        const previousList = getCachedAtomValue(context.registry, listAtom);
        if (previousList === undefined) {
          return;
        }

        setCachedAtomValue(context.registry, listAtom, removeSourceFromList(previousList, sourceId));
        return () => {
          setCachedAtomValue(context.registry, listAtom, previousList);
        };
      },
      onSuccess: (context, sourceId) => {
        context.invalidateQueries({
          workspaceId: context.workspaceId,
          accountId: context.accountId,
          sourceId,
        });
      },
    },
  );

export type {
  CreateSourcePayload,
  LocalInstallation,
  Source,
  SourceInspection,
  SourceInspectionDiscoverResult,
  SourceInspectionToolDetail,
  UpdateSourcePayload,
};
