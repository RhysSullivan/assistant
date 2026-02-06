import { HttpRouter } from "@effect/platform";
import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { RpcSerialization, RpcServer } from "@effect/rpc";
import { Effect, Layer } from "effect";
import { InMemoryCalendarStore } from "./calendar-store.js";
import { AgentRpcs, ResolveApprovalOutput, type TurnResult } from "./rpc.js";
import { createToolingBundle } from "./tools.js";
import { TurnManager } from "./turn-manager.js";

const port = Number(readEnv("OPENASSISTANT_GATEWAY_PORT") ?? "8787");

const calendarStore = new InMemoryCalendarStore();
const tooling = createToolingBundle(calendarStore);
const TurnManagerLayer = TurnManager.layer({
  tools: tooling.tools,
  verboseFooter: isVerboseMode(),
  toolPromptGuidance: tooling.promptGuidance,
  toolTypeDeclarations: tooling.toolTypeDeclarations,
  formatApproval: tooling.formatApproval,
});

const AgentHandlersLive = AgentRpcs.toLayer(
  Effect.gen(function* () {
    const turnManager = yield* TurnManager;
    return {
      RunTurn: (input: { prompt: string; requesterId: string; channelId: string; nowIso: string }) =>
        Effect.gen(function* () {
          const turnId = yield* turnManager.start({
            prompt: input.prompt,
            requesterId: input.requesterId,
            channelId: input.channelId,
            now: new Date(input.nowIso),
          });
          const event = yield* turnManager.waitForNext(turnId);
          if (!event) {
            return {
              status: "failed",
              turnId,
              error: "Turn not found.",
            } as TurnResult;
          }
          return event;
        }),
      ContinueTurn: (input: { turnId: string }) =>
        Effect.gen(function* () {
          const event = yield* turnManager.waitForNext(input.turnId);
          if (!event) {
            return {
              status: "failed",
              turnId: input.turnId,
              error: "Turn not found.",
            } as TurnResult;
          }
          return event;
        }),
      ResolveApproval: (input: { turnId: string; callId: string; actorId: string; decision: "approved" | "denied" }) =>
        Effect.gen(function* () {
          const status = yield* turnManager.resolveApproval({
            turnId: input.turnId,
            callId: input.callId,
            actorId: input.actorId,
            decision: input.decision,
          });
          return new ResolveApprovalOutput({ status });
        }),
    };
  }),
).pipe(Layer.provide(TurnManagerLayer));

const RpcLayer = RpcServer.layer(AgentRpcs).pipe(Layer.provide(AgentHandlersLive));

const HttpProtocolLayer = RpcServer.layerProtocolHttp({
  path: "/rpc",
}).pipe(Layer.provide(RpcSerialization.layerNdjson));

const MainLayer = HttpRouter.Default.serve().pipe(
  Layer.provide(RpcLayer),
  Layer.provide(HttpProtocolLayer),
  Layer.provide(BunHttpServer.layer({ port })),
);

console.log(`[gateway] listening on http://localhost:${port}/rpc`);
BunRuntime.runMain(Layer.launch(MainLayer));

function isVerboseMode(): boolean {
  const value = readEnv("OPENASSISTANT_VERBOSE_RESPONSE")?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function readEnv(key: string): string | undefined {
  const bun = (globalThis as { Bun?: { env?: Record<string, string | undefined> } }).Bun;
  return bun?.env?.[key] ?? process.env[key];
}
