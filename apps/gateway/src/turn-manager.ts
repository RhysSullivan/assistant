import {
  createCodeModeRunner,
  type ApprovalDecision,
  type ApprovalRequest,
  type ToolTree,
} from "@openassistant/core";
import type { AgentLoopResult } from "./agent-loop.js";
import { runAgentLoopWithAnthropic } from "./agent-loop.js";
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

type TurnManagerParams = {
  tools: ToolTree;
  toolPromptGuidance: string;
  toolTypeDeclarations: string;
  formatApproval: (request: ApprovalRequest) => ApprovalPresentation;
};

export type ResolveApprovalStatus = "resolved" | "not_found" | "unauthorized";

type WaitForNextResult =
  | { kind: "missing" }
  | { kind: "event"; event: TurnEvent }
  | { kind: "wait"; deferred: Deferred.Deferred<TurnEvent> };

type ResolveApprovalResult =
  | { status: "not_found" }
  | { status: "unauthorized" }
  | {
      status: "resolved";
      pending: Deferred.Deferred<ApprovalDecision>;
      nextWaiter: Deferred.Deferred<void> | null;
    };

type TurnManagerService = Effect.Effect.Success<ReturnType<typeof makeTurnManager>>;

export class TurnManager extends Context.Tag("@openassistant/gateway/TurnManager")<
  TurnManager,
  TurnManagerService
>() {
  static layer(params: TurnManagerParams): Layer.Layer<TurnManager> {
    return Layer.effect(TurnManager, makeTurnManager(params));
  }
}

function makeTurnManager(params: TurnManagerParams) {
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

      yield* emitEvent(turnId, toApprovalEvent(turnId, request, formatted, state.currentCode));

      return yield* Deferred.await(decision);
    });

    const setCurrentCode = Effect.fn("TurnManager.setCurrentCode")(function* (turnId: string, code: string | null) {
      yield* Ref.update(sessionsRef, (sessions) => {
        const session = sessions.get(turnId);
        if (session) {
          session.currentCode = code;
        }
        return sessions;
      });
    });

    const runSession = Effect.fn("TurnManager.runSession")(function* (turnId: string, prompt: string, now: Date) {
      const runner = createCodeModeRunner({
        tools: params.tools,
        requestApproval: (request) => requestApproval(turnId, request),
      });

      const runCode = Effect.fn("TurnManager.runCode")(function* (code: string) {
        yield* setCurrentCode(turnId, code);
        return yield* runner.run({ code }).pipe(Effect.ensuring(setCurrentCode(turnId, null)));
      });

      yield* runAgentLoopWithAnthropic({
        prompt,
        now,
        toolPromptGuidance: params.toolPromptGuidance,
        toolTypeDeclarations: params.toolTypeDeclarations,
        runCode,
      }).pipe(
        Effect.matchEffect({
          onSuccess: (generated) => emitEvent(turnId, toCompletedEvent(turnId, generated)),
          onFailure: (error) => emitEvent(turnId, toFailedEvent(turnId, describeUnknown(error))),
        }),
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

      const next = yield* Ref.modify(
        sessionsRef,
        (sessions): readonly [WaitForNextResult, Map<string, TurnSession>] => {
          const session = sessions.get(turnId);
          if (!session) {
            return [{ kind: "missing" }, sessions];
          }
          if (session.queue.length > 0) {
            const event = session.queue.shift()!;
            cleanupIfTerminal(sessions, session, event);
            return [{ kind: "event", event }, sessions];
          }
          if (session.waitingEvent) {
            return [{ kind: "wait", deferred: session.waitingEvent }, sessions];
          }
          session.waitingEvent = deferred;
          return [{ kind: "wait", deferred }, sessions];
        },
      );

      if (next.kind === "missing") {
        return null;
      }
      if (next.kind === "event") {
        return next.event;
      }

      const event = yield* Deferred.await(next.deferred);
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
        (sessions): readonly [ResolveApprovalResult, Map<string, TurnSession>] => {
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

    return {
      start,
      waitForNext,
      resolveApproval,
    };
  });
}

function toCompletedEvent(turnId: string, generated: AgentLoopResult): TurnResult {
  return {
    status: "completed",
    turnId,
    message: generated.text,
    planner: generated.planner,
    codeRuns: generated.runs.length,
    footer: generated.planner,
  };
}

function toApprovalEvent(
  turnId: string,
  request: ApprovalRequest,
  formatted: ApprovalPresentation,
  currentCode: string | null,
): TurnResult {
  return {
    status: "awaiting_approval",
    turnId,
    approval: {
      callId: request.callId,
      toolPath: request.toolPath,
      title: formatted.title,
      details: formatted.details,
      link: formatted.link,
      inputPreview: formatted.inputPreview,
      codeSnippet: currentCode ? truncateCode(currentCode) : undefined,
    },
  };
}

function toFailedEvent(turnId: string, error: string): TurnResult {
  return {
    status: "failed",
    turnId,
    error,
  };
}

function newTurnId(): string {
  return crypto.randomUUID();
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
