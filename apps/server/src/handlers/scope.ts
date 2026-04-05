import { HttpApiBuilder } from "@effect/platform";
import { Effect } from "effect";

import { ExecutorApi } from "@executor/api";
import { ExecutorService } from "../services/executor";

export const ScopeHandlers = HttpApiBuilder.group(
  ExecutorApi,
  "scope",
  (handlers) =>
    handlers.handle("info", () =>
      Effect.gen(function* () {
        const executor = yield* ExecutorService;
        return {
          id: executor.scope.id,
          name: executor.scope.name,
        };
      }),
    ),
);
