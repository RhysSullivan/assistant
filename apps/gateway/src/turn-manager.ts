import {
  createCodeModeRunner,
  type ApprovalDecision,
  type ApprovalRequest,
  type ToolTree,
} from "@openassistant/core";
import type { AgentLoopResult } from "./agent-loop.js";
import { runAgentLoop } from "./agent-loop.js";
import type { ApprovalPresentation } from "./plugins/plugin-system.js";
import { type TurnResult } from "./rpc.js";
import { Context, Deferred, Effect, Layer, Ref } from "effect";

type PendingApproval = {
  callId: string;
  toolPath: string;
  inputPreview?: string;
  decision: Deferred.Deferred<ApprovalDecision>;
};

type TurnEvent = TurnResult;

type TurnSession = {
  id: string;
  requesterId: string;
  channelId: string;
  currentCode: string | null;
  queue: TurnEvent[];
  waitingEvent: Deferred.Deferred<TurnEvent> | null;
  pendingApproval: PendingApproval | null;
  approvalWaiters: Array<Deferred.Deferred<void>>;
  completed: boolean;
};

export type ResolveApprovalStatus = "resolved" | "not_found" | "unauthorized";

type WaitForNextState =
  | { _tag: "missing" }
  | { _tag: "event"; event: TurnEvent }
  | { _tag: "await"; deferred: Deferred.Deferred<TurnEvent> };

type ResolveApprovalState =
  | { status: "not_found" }
  | { status: "unauthorized" }
  | {
      status: "resolved";
      pending: Deferred.Deferred<ApprovalDecision>;
      nextWaiter: Deferred.Deferred<void> | null;
    };

export class TurnManager extends Context.Tag("@openassistant/gateway/TurnManager")<
  TurnManager,
  {
    readonly start: (params: {
      prompt: string;
      requesterId: string;
      channelId: string;
      now: Date;
    }) => Effect.Effect<string>;
    readonly waitForNext: (turnId: string) => Effect.Effect<TurnEvent | null>;
    readonly resolveApproval: (params: {
      turnId: string;
      callId: string;
      actorId: string;
      decision: ApprovalDecision;
    }) => Effect.Effect<ResolveApprovalStatus>;
  }
>() {
  static layer(params: {
    tools: ToolTree;
    verboseFooter: boolean;
    toolPromptGuidance: string;
    toolTypeDeclarations: string;
    formatApproval: (request: ApprovalRequest) => ApprovalPresentation;
  }): Layer.Layer<TurnManager> {
    return Layer.effect(TurnManager, makeTurnManager(params));
  }
}

function makeTurnManager(params: {
  tools: ToolTree;
  verboseFooter: boolean;
  toolPromptGuidance: string;
  toolTypeDeclarations: string;
  formatApproval: (request: ApprovalRequest) => ApprovalPresentation;
}) {
  return Effect.gen(function* () {
    const sessionsRef = yield* Ref.make(new Map<string, TurnSession>());

    const markCompleted = Effect.fn("TurnManager.markCompleted")(function* (turnId: string) {
      yield* Ref.update(sessionsRef, (sessions) => {
        const session = sessions.get(turnId);
        if (session) {
          session.completed = true;
        }
        return sessions;
      });
    });

    const emitEvent = Effect.fn("TurnManager.emitEvent")(function* (turnId: string, event: TurnEvent) {
      const waiter = yield* Ref.modify(sessionsRef, (sessions) => {
        const session = sessions.get(turnId);
        if (!session) {
          return [null as Deferred.Deferred<TurnEvent> | null, sessions] as const;
        }
        if (session.waitingEvent) {
          const waiting = session.waitingEvent;
          session.waitingEvent = null;
          return [waiting, sessions] as const;
        }
        session.queue.push(event);
        return [null as Deferred.Deferred<TurnEvent> | null, sessions] as const;
      });

      if (waiter) {
        yield* Deferred.succeed(waiter, event);
      }
    });

    const waitForApprovalSlot = Effect.fn("TurnManager.waitForApprovalSlot")(function* (turnId: string) {
      while (true) {
        const waiter = yield* Deferred.make<void>();
        const state = yield* Ref.modify(sessionsRef, (sessions) => {
          const session = sessions.get(turnId);
          if (!session) {
            return ["missing" as const, sessions] as const;
          }
          if (!session.pendingApproval) {
            return ["ready" as const, sessions] as const;
          }
          session.approvalWaiters.push(waiter);
          return ["wait" as const, sessions] as const;
        });

        if (state !== "wait") {
          return;
        }
        yield* Deferred.await(waiter);
      }
    });

    const requestApproval = Effect.fn("TurnManager.requestApproval")(function* (
      turnId: string,
      request: ApprovalRequest,
    ) {
      yield* waitForApprovalSlot(turnId);

      const decision = yield* Deferred.make<ApprovalDecision>();
      const state = yield* Ref.modify(sessionsRef, (sessions) => {
        const session = sessions.get(turnId);
        if (!session) {
          return [null as null | { currentCode: string | null }, sessions] as const;
        }
        session.pendingApproval = {
          callId: request.callId,
          toolPath: request.toolPath,
          ...(request.inputPreview ? { inputPreview: request.inputPreview } : {}),
          decision,
        };
        return [{ currentCode: session.currentCode }, sessions] as const;
      });

      if (!state) {
        return "denied" as const;
      }

      const formatted = params.formatApproval(request);

      yield* emitEvent(turnId, {
        status: "awaiting_approval",
        turnId,
        approval: {
          callId: request.callId,
          toolPath: request.toolPath,
          ...(formatted.title ? { title: formatted.title } : {}),
          ...(formatted.details ? { details: formatted.details } : {}),
          ...(formatted.link ? { link: formatted.link } : {}),
          ...(formatted.inputPreview ? { inputPreview: formatted.inputPreview } : {}),
          ...(state.currentCode ? { codeSnippet: truncateCode(state.currentCode) } : {}),
        },
      });

      return yield* Deferred.await(decision);
    });

    const runSession = Effect.fn("TurnManager.runSession")(function* (turnId: string, prompt: string, now: Date) {
      const runner = createCodeModeRunner({
        tools: params.tools,
        requestApproval: (request) => requestApproval(turnId, request),
      });

      yield* Effect.tryPromise({
        try: () =>
          runAgentLoop(
            prompt,
            async (code) => {
              await Effect.runPromise(
                Ref.update(sessionsRef, (sessions) => {
                  const session = sessions.get(turnId);
                  if (session) {
                    session.currentCode = code;
                  }
                  return sessions;
                }),
              );
              const result = await Effect.runPromise(runner.run({ code }));
              await Effect.runPromise(
                Ref.update(sessionsRef, (sessions) => {
                  const session = sessions.get(turnId);
                  if (session) {
                    session.currentCode = null;
                  }
                  return sessions;
                }),
              );
              return result;
            },
            {
              now,
              toolPromptGuidance: params.toolPromptGuidance,
              toolTypeDeclarations: params.toolTypeDeclarations,
            },
          ),
        catch: describeUnknown,
      }).pipe(
        Effect.flatMap((generated) => emitEvent(turnId, toCompletedEvent(turnId, generated, params.verboseFooter))),
        Effect.catchAll((error) =>
          emitEvent(turnId, {
            status: "failed",
            turnId,
            error,
          }),
        ),
      );
    });

    const start = Effect.fn("TurnManager.start")(function* (input: {
      prompt: string;
      requesterId: string;
      channelId: string;
      now: Date;
    }) {
      const turnId = newTurnId();
      const session: TurnSession = {
        id: turnId,
        requesterId: input.requesterId,
        channelId: input.channelId,
        currentCode: null,
        queue: [],
        waitingEvent: null,
        pendingApproval: null,
        approvalWaiters: [],
        completed: false,
      };

      yield* Ref.update(sessionsRef, (sessions) => {
        sessions.set(turnId, session);
        return sessions;
      });

      yield* runSession(turnId, input.prompt, input.now).pipe(
        Effect.ensuring(markCompleted(turnId)),
        Effect.forkDaemon,
      );

      return turnId;
    });

    const waitForNext = Effect.fn("TurnManager.waitForNext")(function* (turnId: string) {
      const deferred = yield* Deferred.make<TurnEvent>();

      const state = yield* Ref.modify(sessionsRef, (sessions): readonly [WaitForNextState, Map<string, TurnSession>] => {
        const session = sessions.get(turnId);
        if (!session) {
          return [{ _tag: "missing" }, sessions];
        }
        if (session.queue.length > 0) {
          const event = session.queue.shift()!;
          cleanupIfTerminal(sessions, session, event);
          return [{ _tag: "event", event }, sessions];
        }
        if (session.waitingEvent) {
          return [{ _tag: "await", deferred: session.waitingEvent }, sessions];
        }
        session.waitingEvent = deferred;
        return [{ _tag: "await", deferred }, sessions];
      });

      if (state._tag === "missing") {
        return null;
      }
      if (state._tag === "event") {
        return state.event;
      }

      const event = yield* Deferred.await(state.deferred);
      yield* Ref.update(sessionsRef, (sessions) => {
        const session = sessions.get(turnId);
        if (session) {
          cleanupIfTerminal(sessions, session, event);
        }
        return sessions;
      });

      return event;
    });

    const resolveApproval = Effect.fn("TurnManager.resolveApproval")(function* (input: {
      turnId: string;
      callId: string;
      actorId: string;
      decision: ApprovalDecision;
    }) {
      const result = yield* Ref.modify(
        sessionsRef,
        (sessions): readonly [ResolveApprovalState, Map<string, TurnSession>] => {
          const session = sessions.get(input.turnId);
          if (!session) {
            return [{ status: "not_found" }, sessions];
          }
          if (session.requesterId !== input.actorId) {
            return [{ status: "unauthorized" }, sessions];
          }
          if (!session.pendingApproval || session.pendingApproval.callId !== input.callId) {
            return [{ status: "not_found" }, sessions];
          }

          const pending = session.pendingApproval;
          session.pendingApproval = null;
          const nextWaiter = session.approvalWaiters.shift() ?? null;

          return [{ status: "resolved", pending: pending.decision, nextWaiter }, sessions];
        },
      );

      if (result.status !== "resolved") {
        return result.status;
      }

      yield* Deferred.succeed(result.pending, input.decision);
      if (result.nextWaiter) {
        yield* Deferred.succeed(result.nextWaiter, undefined);
      }
      return "resolved" as const;
    });

    return TurnManager.of({
      start,
      waitForNext,
      resolveApproval,
    });
  });
}

function toCompletedEvent(turnId: string, generated: AgentLoopResult, includeFooter: boolean): TurnResult {
  return {
    status: "completed",
    turnId,
    message: generated.text,
    planner: generated.planner,
    codeRuns: generated.runs.length,
    ...(includeFooter ? { footer: generated.planner } : {}),
  };
}

function newTurnId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function describeUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function cleanupIfTerminal(sessions: Map<string, TurnSession>, session: TurnSession, event: TurnEvent): void {
  if ((event.status === "completed" || event.status === "failed") && session.completed) {
    sessions.delete(session.id);
  }
}

function truncateCode(code: string): string {
  const maxChars = 1500;
  if (code.length <= maxChars) {
    return code;
  }
  return `${code.slice(0, maxChars)}\n// ...truncated`;
}
