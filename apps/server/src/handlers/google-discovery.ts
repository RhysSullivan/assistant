import { Effect, Layer } from "effect";
import {
  GoogleDiscoveryExtensionService,
  GoogleDiscoveryHandlers,
} from "@executor/plugin-google-discovery/api";
import { ExecutorService } from "../services/executor";

const GoogleDiscoveryExtensionLive = Layer.effect(
  GoogleDiscoveryExtensionService,
  Effect.map(ExecutorService, (executor) => executor.googleDiscovery),
);

export const GoogleDiscoveryHandlersLive = Layer.provide(
  GoogleDiscoveryHandlers,
  GoogleDiscoveryExtensionLive,
);
