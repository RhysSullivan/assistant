import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type PmConfigService = {
  port: number;
};

export class PmConfig extends Context.Tag("@executor-v2/app-pm/PmConfig")<
  PmConfig,
  PmConfigService
>() {}

export const PmConfigLive = Layer.effect(
  PmConfig,
  Effect.gen(function* () {
    const port = yield* Config.integer("PORT").pipe(
      Config.orElse(() => Config.succeed(8787)),
    );

    return PmConfig.of({
      port,
    });
  }),
);
