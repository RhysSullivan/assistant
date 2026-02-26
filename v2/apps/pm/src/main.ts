import { makeLocalInProcessRuntimeAdapter } from "@executor-v2/engine";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PmConfigLive } from "./config";
import { startPmHttpServer } from "./http-server";
import { PmMcpHandlerLive } from "./mcp-handler";
import {
  PmRunExecutorLive,
  PmToolProviderRegistryLive,
} from "./run-executor";

const runtimeAdapter = makeLocalInProcessRuntimeAdapter();
const PmMcpDependenciesLive = Layer.merge(
  PmRunExecutorLive(runtimeAdapter),
  PmToolProviderRegistryLive,
);

const PmAppLive = Layer.merge(
  PmConfigLive,
  PmMcpHandlerLive.pipe(Layer.provide(PmMcpDependenciesLive)),
);

const program = startPmHttpServer().pipe(Effect.provide(PmAppLive));

await Effect.runPromise(program);
