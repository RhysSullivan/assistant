import type { ControlPlaneServiceShape } from "#api";
import {
  ControlPlaneBadRequestError,
  ControlPlaneNotFoundError,
  ControlPlaneStorageError,
} from "#api";
import {
  ControlPlanePersistenceError,
  type SqlControlPlaneRows,
} from "#persistence";
import type { Execution } from "#schema";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  type ResolveExecutionEnvironment,
  ResumeUnsupportedError,
} from "./execution-state";
import {
  makeLiveExecutionManager,
  type LiveExecutionManager,
} from "./live-execution";

const badRequest = (
  operation: string,
  message: string,
  details: string,
): ControlPlaneBadRequestError =>
  new ControlPlaneBadRequestError({
    operation,
    message,
    details,
  });

const notFound = (
  operation: string,
  message: string,
  details: string,
): ControlPlaneNotFoundError =>
  new ControlPlaneNotFoundError({
    operation,
    message,
    details,
  });

const storageFromPersistence = (
  operation: string,
  error: ControlPlanePersistenceError,
): ControlPlaneStorageError =>
  new ControlPlaneStorageError({
    operation,
    message: error.message,
    details: error.details ?? "Persistence operation failed",
  });

const mapStorageError = <A>(
  operation: string,
  effect: Effect.Effect<A, ControlPlanePersistenceError>,
): Effect.Effect<A, ControlPlaneStorageError> =>
  effect.pipe(Effect.mapError((error) => storageFromPersistence(operation, error)));

const requireTrimmed = (
  operation: string,
  fieldName: string,
  value: string,
): Effect.Effect<string, ControlPlaneBadRequestError> => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return Effect.fail(
      badRequest(
        operation,
        `Invalid ${fieldName}`,
        `${fieldName} must be a non-empty string`,
      ),
    );
  }

  return Effect.succeed(trimmed);
};

const serializeJson = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }

  return JSON.stringify(value);
};

const ElicitationActionSchema = Schema.Literal("accept", "decline", "cancel");

const ElicitationResponseSchema = Schema.Struct({
  action: ElicitationActionSchema,
  content: Schema.optional(
    Schema.Record({
      key: Schema.String,
      value: Schema.Unknown,
    }),
  ),
});

const decodeElicitationResponse = Schema.decodeUnknown(ElicitationResponseSchema);

const defaultExecutionResolver: ResolveExecutionEnvironment = () =>
  Effect.fail(
    new Error("Execution environment resolver is not configured"),
  );

const defaultLiveExecutionManager = makeLiveExecutionManager();

const fetchExecution = (
  rows: SqlControlPlaneRows,
  input: {
    workspaceId: Execution["workspaceId"];
    executionId: Execution["id"];
    operation: string;
  },
): Effect.Effect<Execution, ControlPlaneNotFoundError | ControlPlaneStorageError> =>
  Effect.gen(function* () {
    const existing = yield* mapStorageError(
      input.operation,
      rows.executions.getByWorkspaceAndId(input.workspaceId, input.executionId),
    );

    if (Option.isNone(existing)) {
      return yield* Effect.fail(
        notFound(
          input.operation,
          "Execution not found",
          `workspaceId=${input.workspaceId} executionId=${input.executionId}`,
        ),
      );
    }

    return existing.value;
  });

export const makeRuntimeExecutionsService = (
  rows: SqlControlPlaneRows,
  executionResolver: ResolveExecutionEnvironment = defaultExecutionResolver,
  liveExecutionManager: LiveExecutionManager = defaultLiveExecutionManager,
): Pick<
  ControlPlaneServiceShape,
  | "createExecution"
  | "getExecution"
  | "resumeExecution"
> => ({
    createExecution: ({ workspaceId, payload, createdByAccountId }) =>
      (Effect.gen(function* () {
        const code = yield* requireTrimmed("executions.create", "code", payload.code);
        const now = Date.now();
        const execution: Execution = {
          id: `exec_${crypto.randomUUID()}` as Execution["id"],
          workspaceId,
          createdByAccountId,
          status: "pending",
          code,
          resultJson: null,
          errorText: null,
          logsJson: null,
          startedAt: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };

        yield* mapStorageError(
          "executions.create.insert",
          rows.executions.insert(execution),
        );

        const running = yield* mapStorageError(
          "executions.create.mark_running",
          rows.executions.update(execution.id, {
            status: "running",
            startedAt: now,
            updatedAt: now,
          }),
        );

        if (Option.isNone(running)) {
          return yield* Effect.fail(
            notFound(
              "executions.create",
              "Execution not found after insert",
              `executionId=${execution.id}`,
            ),
          );
        }

        const environment = yield* executionResolver({
          workspaceId,
          accountId: createdByAccountId,
          executionId: execution.id,
          onElicitation: liveExecutionManager.createOnElicitation({
            rows,
            executionId: execution.id,
          }),
        }).pipe(
          Effect.mapError((error) =>
            new ControlPlaneStorageError({
              operation: "executions.create.environment",
              message: error instanceof Error ? error.message : String(error),
              details: "Execution environment resolution failed",
            }),
          ),
        );

        const nextState = yield* liveExecutionManager.registerStateWaiter(execution.id);

        yield* Effect.sync(() => {
          Effect.runFork(
            environment.executor.execute(code, environment.toolInvoker).pipe(
              Effect.flatMap((outcome) => {
                const completedAt = Date.now();
                return mapStorageError(
                  "executions.create.complete",
                  rows.executions.update(execution.id, {
                    status: outcome.error ? "failed" : "completed",
                    resultJson: serializeJson(outcome.result),
                    errorText: outcome.error ?? null,
                    logsJson: serializeJson(outcome.logs ?? null),
                    completedAt,
                    updatedAt: completedAt,
                  }),
                ).pipe(
                  Effect.flatMap((updated) =>
                    Option.isNone(updated)
                      ? Effect.fail(
                          notFound(
                            "executions.create",
                            "Execution not found after completion",
                            `executionId=${execution.id}`,
                          ),
                        )
                      : Effect.succeed(updated.value),
                  ),
                  Effect.flatMap((updated) =>
                    liveExecutionManager.finishRun({
                      executionId: execution.id,
                      state: updated.status === "completed" ? "completed" : "failed",
                    }).pipe(Effect.as(updated)),
                  ),
                );
              }),
              Effect.catchAll((error) => {
                const completedAt = Date.now();
                return mapStorageError(
                  "executions.create.complete_error",
                  rows.executions.update(execution.id, {
                    status: "failed",
                    errorText: error instanceof Error ? error.message : String(error),
                    completedAt,
                    updatedAt: completedAt,
                  }),
                ).pipe(
                  Effect.zipRight(
                    liveExecutionManager.finishRun({
                      executionId: execution.id,
                      state: "failed",
                    }),
                  ),
                  Effect.catchAll(() => liveExecutionManager.clearRun(execution.id)),
                );
              }),
            ),
          );
        });

        yield* Deferred.await(nextState);

        return yield* fetchExecution(rows, {
          workspaceId,
          executionId: execution.id,
          operation: "executions.create",
        });
      }) as Effect.Effect<
        Execution,
        ControlPlaneBadRequestError | ControlPlaneNotFoundError | ControlPlaneStorageError
      >),

    getExecution: ({ workspaceId, executionId }) =>
      fetchExecution(rows, {
        workspaceId,
        executionId,
        operation: "executions.get",
      }),

    resumeExecution: ({ workspaceId, executionId, payload }) =>
      Effect.gen(function* () {
        const existing = yield* fetchExecution(rows, {
          workspaceId,
          executionId,
          operation: "executions.resume",
        });

        if (existing.status !== "waiting_for_interaction") {
          return yield* Effect.fail(
            badRequest(
              "executions.resume",
              "Execution is not waiting for interaction",
              `executionId=${executionId} status=${existing.status}`,
            ),
          );
        }

        const responseJson = payload.responseJson;
        const response =
          responseJson === undefined
            ? { action: "accept" as const }
            : yield* Effect.try({
                try: () => JSON.parse(responseJson),
                catch: (error) =>
                  badRequest(
                    "executions.resume",
                    "Invalid responseJson",
                    error instanceof Error ? error.message : String(error),
                  ),
              }).pipe(
                Effect.flatMap((decoded) =>
                  decodeElicitationResponse(decoded).pipe(
                    Effect.mapError((error) =>
                      badRequest(
                        "executions.resume",
                        "Invalid responseJson",
                        String(error),
                      ),
                    ),
                  ),
                ),
              );

        const nextState = yield* liveExecutionManager.registerStateWaiter(executionId);
        const resumed = yield* liveExecutionManager.resolveInteraction({
          executionId,
          response,
        });

        if (!resumed) {
          return yield* Effect.fail(
            badRequest(
              "executions.resume",
              "Resume is unavailable for this execution",
              `executionId=${executionId} mode=${new ResumeUnsupportedError({ executionId })._tag}`,
            ),
          );
        }

        yield* Deferred.await(nextState);

        return yield* fetchExecution(rows, {
          workspaceId,
          executionId,
          operation: "executions.resume",
        });
      }),
  });
