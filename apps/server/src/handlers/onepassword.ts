import { Effect, Layer } from "effect";
import {
  OnePasswordHandlers,
  OnePasswordExtensionService,
} from "@executor/plugin-onepassword/api";
import { ExecutorService } from "../services/executor";

// Wire OnePasswordExtensionService from the executor's onepassword extension
const OnePasswordExtensionLive = Layer.effect(
  OnePasswordExtensionService,
  Effect.map(ExecutorService, (executor) => executor.onepassword),
);

export const OnePasswordHandlersLive = Layer.provide(
  OnePasswordHandlers,
  OnePasswordExtensionLive,
);
