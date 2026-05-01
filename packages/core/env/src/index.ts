import { Config, ConfigProvider, Context, Effect, Layer, Option, Result, Schema } from "effect";
import type * as ConfigModule from "effect/Config";
import * as SchemaIssue from "effect/SchemaIssue";

export const Env = {
  string: (name: string) => Config.string(name),
  number: (name: string) => Config.number(name),
  boolean: (name: string) => Config.boolean(name),
  redacted: (name: string) => Config.redacted(name),

  stringOr: (name: string, defaultValue: string) =>
    Config.string(name).pipe(Config.withDefault(defaultValue)),
  numberOr: (name: string, defaultValue: number) =>
    Config.number(name).pipe(Config.withDefault(defaultValue)),
  booleanOr: (name: string, defaultValue: boolean) =>
    Config.boolean(name).pipe(Config.withDefault(defaultValue)),

  optionalString: (name: string) => Config.string(name).pipe(Config.option),
  optionalNumber: (name: string) => Config.number(name).pipe(Config.option),
  optionalBoolean: (name: string) => Config.boolean(name).pipe(Config.option),

  literal: <const T extends string>(name: string, ...values: readonly [T, ...T[]]) =>
    Config.string(name).pipe(
      Config.mapOrFail((value) =>
        values.includes(value as T)
          ? Effect.succeed(value as T)
          : Effect.fail(configError(`Expected one of: ${values.join(", ")}`)),
      ),
    ),

  literalOr: <const T extends string>(
    name: string,
    defaultValue: NoInfer<T>,
    ...values: readonly [T, ...T[]]
  ) =>
    Config.string(name).pipe(
      Config.withDefault(defaultValue),
      Config.mapOrFail((value) =>
        values.includes(value as T)
          ? Effect.succeed(value as T)
          : Effect.fail(configError(`Expected one of: ${values.join(", ")}`)),
      ),
    ),

  url: (name: string) =>
    Config.string(name).pipe(
      Config.mapOrFail((value) => {
        try {
          new URL(value);
          return Effect.succeed(value);
        } catch {
          return Effect.fail(configError("Invalid URL"));
        }
      }),
    ),

  urlOr: (name: string, defaultValue: string) =>
    Config.string(name).pipe(
      Config.withDefault(defaultValue),
      Config.mapOrFail((value) => {
        try {
          new URL(value);
          return Effect.succeed(value);
        } catch {
          return Effect.fail(configError("Invalid URL"));
        }
      }),
    ),
};

const configError = (message: string): ConfigModule.ConfigError =>
  new Config.ConfigError(
    new Schema.SchemaError(
      new SchemaIssue.InvalidValue(Option.none(), { message }),
    ),
  );

type ConfigShape = Record<string, ConfigModule.Config<unknown>>;

type InferConfigShape<Shape extends ConfigShape> = {
  readonly [K in keyof Shape]: Shape[K] extends ConfigModule.Config<infer A> ? A : never;
};

export interface EnvService<
  Id extends string,
  Shape extends Record<string, ConfigModule.Config<unknown>>,
> extends Context.Service<EnvService<Id, Shape>, InferConfigShape<Shape>> {
  readonly config: ConfigModule.Config<InferConfigShape<Shape>>;
  readonly Default: Layer.Layer<EnvService<Id, Shape>, ConfigModule.ConfigError>;
}

export const makeEnv = <
  const Id extends string,
  const Shape extends Record<string, ConfigModule.Config<unknown>>,
>(
  id: Id,
  shape: Shape,
): EnvService<Id, Shape> => {
  const config = Config.all(shape) as ConfigModule.Config<InferConfigShape<Shape>>;

  const tag = Context.Service<EnvService<Id, Shape>, InferConfigShape<Shape>>(id);
  const Default = Layer.effect(tag, Effect.gen(function* () {
    return yield* config;
  }));

  return Object.assign(tag, { config, Default });
};

type ErrorMessage<T extends string> = T;

type Simplify<T> = {
  [P in keyof T]: T[P];
} & {};

type PossiblyUndefinedKeys<T> = {
  [K in keyof T]: undefined extends T[K] ? K : never;
}[keyof T];

type UndefinedOptional<T> = Partial<Pick<T, PossiblyUndefinedKeys<T>>> &
  Omit<T, PossiblyUndefinedKeys<T>>;

type Mutable<T> = T extends Readonly<infer U> ? U : T;

type Reduce<
  TArr extends readonly Record<string, unknown>[],
  TAcc = object,
> = TArr extends readonly []
  ? TAcc
  : TArr extends readonly [infer Head, ...infer Tail]
    ? Tail extends readonly Record<string, unknown>[]
      ? Mutable<Head> & Omit<Reduce<Tail, TAcc>, keyof Head>
      : never
    : never;

export type RuntimeEnvValue = string | number | boolean | undefined;
export type RuntimeEnv = Record<string, RuntimeEnvValue>;

export interface ValidationIssue {
  readonly type: "InvalidData" | "MissingData" | "SourceUnavailable" | "Unsupported";
  readonly path: ReadonlyArray<string>;
  readonly message: string;
}

export const flattenConfigError = (
  error: ConfigModule.ConfigError,
): ReadonlyArray<ValidationIssue> => {
  return [
    {
      type: error.cause._tag === "SourceError" ? "SourceUnavailable" : "InvalidData",
      path: [],
      message: error.message,
    },
  ];
};

type EnforcePrefixedKeys<TPrefix extends string | undefined, TShape extends ConfigShape> = {
  [TKey in keyof TShape]: TPrefix extends undefined
    ? TShape[TKey]
    : TPrefix extends ""
      ? TShape[TKey]
      : TKey extends `${TPrefix}${string}`
        ? TShape[TKey]
        : ErrorMessage<`${TKey extends string ? TKey : never} is not prefixed with ${TPrefix}.`>;
};

export interface CreateEnvOptions<
  TPrefix extends string | undefined,
  TShape extends ConfigShape,
  TExtends extends readonly Record<string, unknown>[],
  TFinalConfig extends ConfigModule.Config<Record<string, unknown>>,
> {
  prefix?: TPrefix;
  isServer?: boolean;
  runtimeEnv?: RuntimeEnv;
  extends?: TExtends;
  onValidationError?: (
    issues: ReadonlyArray<ValidationIssue>,
    error: ConfigModule.ConfigError,
  ) => never;
  onInvalidAccess?: (variable: string) => never;
  skipValidation?: boolean;
  emptyStringAsUndefined?: boolean;
  createFinalConfig?: (shape: TShape, isServer: boolean) => TFinalConfig;
}

export type DefaultCombinedConfig<TShape extends ConfigShape> = ConfigModule.Config<
  UndefinedOptional<InferConfigShape<TShape>>
>;

type InferEnvOutput<TConfig extends ConfigModule.Config<unknown>> =
  TConfig extends ConfigModule.Config<infer A>
    ? A extends Record<string, unknown>
      ? A
      : never
    : never;



export type CreateEnv<
  TFinalConfig extends ConfigModule.Config<Record<string, unknown>>,
  TExtends extends readonly Record<string, unknown>[],
> = Readonly<Simplify<Reduce<[InferEnvOutput<TFinalConfig>, ...TExtends]>>>;

export const getDefaultRuntimeEnv = (): RuntimeEnv => {
  const processLike = (globalThis as { process?: { env?: RuntimeEnv } }).process;
  if (processLike?.env && typeof processLike.env === "object") {
    return processLike.env;
  }
  return {};
};

const normalizeRuntimeEnv = (
  runtimeEnv: RuntimeEnv,
  emptyStringAsUndefined: boolean,
): RuntimeEnv => {
  const normalized: RuntimeEnv = {};
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === undefined) {
      continue;
    }
    if (emptyStringAsUndefined && value === "") {
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
};

const toRuntimeMap = (runtimeEnv: RuntimeEnv): Map<string, string> => {
  const map = new Map<string, string>();

  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value !== undefined) {
      map.set(key, String(value));
    }
  }

  return map;
};

const mergeExtended = (
  extendsEnvs: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown> =>
  extendsEnvs.reduce<Record<string, unknown>>((acc, current) => Object.assign(acc, current), {});

export function createEnv<
  TPrefix extends string | undefined = undefined,
  const TShape extends ConfigShape = Record<string, never>,
  const TExtends extends readonly Record<string, unknown>[] = [],
  TFinalConfig extends ConfigModule.Config<Record<string, unknown>> = DefaultCombinedConfig<TShape>,
>(
  shape: Partial<EnforcePrefixedKeys<TPrefix, TShape>>,
  options?: CreateEnvOptions<TPrefix, TShape, TExtends, TFinalConfig>,
): CreateEnv<TFinalConfig, TExtends> {
  const opts = options ?? {};

  const normalizedShape = (typeof shape === "object" ? shape : {}) as TShape;

  const normalizedRuntimeEnv = normalizeRuntimeEnv(
    opts.runtimeEnv ?? getDefaultRuntimeEnv(),
    opts.emptyStringAsUndefined ?? false,
  );

  const extendedEnv = mergeExtended(opts.extends ?? []);

  if (opts.skipValidation) {
    return Object.assign(extendedEnv, normalizedRuntimeEnv) as CreateEnv<TFinalConfig, TExtends>;
  }

  const isServer = opts.isServer ?? (!("window" in globalThis) || "Deno" in globalThis);

  const hasKeys = Object.keys(normalizedShape).length > 0;

  const toFinalConfig = (config: Config.Config<unknown>): TFinalConfig =>
    config as TFinalConfig;

  const finalConfig =
    opts.createFinalConfig?.(normalizedShape, isServer) ??
    (hasKeys
      ? toFinalConfig(Config.all(normalizedShape))
      : toFinalConfig(Config.succeed({})));

  const parsed = Effect.runSync(
    Effect.result(
      finalConfig.parse(
        ConfigProvider.fromEnv({
          env: Object.fromEntries(toRuntimeMap(normalizedRuntimeEnv)),
        }),
      ),
    ),
  );

  const onValidationError =
    opts.onValidationError ??
    ((issues: ReadonlyArray<ValidationIssue>) => {
      console.error("❌ Invalid environment variables:", issues);
      throw new Error("Invalid environment variables");
    });

  const onInvalidAccess =
    opts.onInvalidAccess ??
    (() => {
      throw new Error("❌ Attempted to access a server-side environment variable on the client");
    });

  if (Result.isFailure(parsed)) {
    const issues = flattenConfigError(parsed.failure);
    return onValidationError(issues, parsed.failure);
  }

  const prefix = opts.prefix;
  const ignoreProp = (prop: string) => prop === "__esModule" || prop === "$$typeof";

  const fullEnv = Object.assign(extendedEnv, parsed.success);

  return new Proxy(fullEnv, {
    get(target, prop) {
      if (typeof prop !== "string") {
        return undefined;
      }
      if (ignoreProp(prop)) {
        return undefined;
      }
      if (!isServer && prefix && prefix !== "" && !prop.startsWith(prefix)) {
        return onInvalidAccess(prop);
      }
      return Reflect.get(target, prop);
    },
  }) as CreateEnv<TFinalConfig, TExtends>;
}
