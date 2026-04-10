import { describe, expect, it } from "@effect/vitest";
import { assertRight } from "@effect/vitest/utils";
import { Config, ConfigProvider, Effect } from "effect";

import { createEnv, Env, makeEnv } from "./index";

describe("makeEnv", () => {
  it("creates a tag with an Effect Config and default layer", () => {
    const AppEnv = makeEnv("AppEnv", {
      PORT: Env.number("PORT"),
      HOST: Env.stringOr("HOST", "localhost"),
    });

    const parsed = Effect.runSync(
      Effect.withConfigProvider(
        ConfigProvider.fromMap(
          new Map([
            ["PORT", "8080"],
            ["HOST", "0.0.0.0"],
          ]),
        ),
      )(Effect.either(AppEnv.config)),
    );

    assertRight(parsed, {
      PORT: 8080,
      HOST: "0.0.0.0",
    });

    expect(AppEnv.Default).toBeDefined();
  });
});

describe("createEnv", () => {
  it("validates values and supports separate shared/web/server definitions", () => {
    const shared = createEnv(
      {
        NODE_ENV: Env.literal("NODE_ENV", "development", "production", "test"),
      },
      {
        runtimeEnv: {
          NODE_ENV: "development",
        },
      },
    );

    const web = createEnv(
      {
        PUBLIC_API_URL: Env.url("PUBLIC_API_URL"),
      },
      {
        prefix: "PUBLIC_",
        runtimeEnv: {
          PUBLIC_API_URL: "https://api.example.com",
        },
      },
    );

    const server = createEnv(
      {
        PORT: Env.number("PORT"),
      },
      {
        extends: [shared],
        runtimeEnv: {
          PORT: "3000",
        },
      },
    );

    expect(server.PORT).toBe(3000);
    expect(server.NODE_ENV).toBe("development");
    expect(web.PUBLIC_API_URL).toBe("https://api.example.com");
  });

  it("throws with the default validation handler", () => {
    expect(() =>
      createEnv(
        {
          PORT: Env.number("PORT"),
        },
        {
          runtimeEnv: {
            PORT: "not-a-number",
          },
        },
      ),
    ).toThrow("Invalid environment variables");
  });

  it("supports custom validation handlers", () => {
    expect(() =>
      createEnv(
        {
          PORT: Env.number("PORT"),
        },
        {
          runtimeEnv: {
            PORT: "nope",
          },
          onValidationError: (issues) => {
            const portIssue = issues.find((issue) => issue.path.includes("PORT"));
            throw new Error(`PORT invalid: ${portIssue?.message ?? "unknown"}`);
          },
        },
      ),
    ).toThrow("PORT invalid:");
  });

  it("prevents non-prefixed variable access on the client", () => {
    const secret = createEnv(
      {
        SECRET: Env.string("SECRET"),
      },
      {
        runtimeEnv: {
          SECRET: "top-secret",
        },
      },
    );

    const env = createEnv(
      {
        PUBLIC_SITE_NAME: Env.string("PUBLIC_SITE_NAME"),
      },
      {
        prefix: "PUBLIC_",
        extends: [secret],
        runtimeEnv: {
          PUBLIC_SITE_NAME: "executor",
        },
        isServer: false,
      },
    );

    expect(() => env.SECRET).toThrow(
      "❌ Attempted to access a server-side environment variable on the client",
    );
    expect(env.PUBLIC_SITE_NAME).toBe("executor");
  });

  it("supports custom invalid-access handlers", () => {
    const secret = createEnv(
      {
        SECRET: Env.string("SECRET"),
      },
      {
        runtimeEnv: {
          SECRET: "top-secret",
        },
      },
    );

    const env = createEnv(
      {
        PUBLIC_SITE_NAME: Env.string("PUBLIC_SITE_NAME"),
      },
      {
        prefix: "PUBLIC_",
        extends: [secret],
        runtimeEnv: {
          PUBLIC_SITE_NAME: "executor",
        },
        isServer: false,
        onInvalidAccess: (variable) => {
          throw new Error(`Blocked ${variable}`);
        },
      },
    );

    expect(() => env.SECRET).toThrow("Blocked SECRET");
  });

  it("treats empty strings as undefined when requested", () => {
    const withoutOption = createEnv(
      {
        HOST: Env.stringOr("HOST", "localhost"),
      },
      {
        runtimeEnv: {
          HOST: "",
        },
      },
    );

    const withOption = createEnv(
      {
        HOST: Env.stringOr("HOST", "localhost"),
      },
      {
        runtimeEnv: {
          HOST: "",
        },
        emptyStringAsUndefined: true,
      },
    );

    expect(withoutOption.HOST).toBe("");
    expect(withOption.HOST).toBe("localhost");
  });

  it("extends other env objects and allows local overrides", () => {
    const preset = createEnv(
      {
        PRESET_ENV: Env.literal("PRESET_ENV", "preset", "overridden"),
        PRESET_SECRET: Env.string("PRESET_SECRET"),
      },
      {
        runtimeEnv: {
          PRESET_ENV: "preset",
          PRESET_SECRET: "preset-secret",
        },
      },
    );

    const env = createEnv(
      {
        PRESET_ENV: Env.literal("PRESET_ENV", "overridden"),
        APP_ENV: Env.string("APP_ENV"),
      },
      {
        extends: [preset],
        runtimeEnv: {
          PRESET_ENV: "overridden",
          APP_ENV: "local",
        },
      },
    );

    expect(env.PRESET_ENV).toBe("overridden");
    expect(env.PRESET_SECRET).toBe("preset-secret");
    expect(env.APP_ENV).toBe("local");
  });

  it("supports skipping validation", () => {
    const env = createEnv(
      {
        PORT: Env.number("PORT"),
      },
      {
        runtimeEnv: {
          PORT: "not-a-number",
        },
        skipValidation: true,
      },
    );

    expect(env.PORT).toBe("not-a-number");
  });

  it("supports createFinalConfig transformations", () => {
    const env = createEnv(
      {
        HOST: Env.string("HOST"),
        PORT: Env.number("PORT"),
      },
      {
        runtimeEnv: {
          HOST: "localhost",
          PORT: "4000",
        },
        createFinalConfig: (shape) =>
          Config.all(shape).pipe(
            Config.map((value) => ({
              ...value,
              BASE_URL: `http://${value.HOST}:${value.PORT}`,
            })),
          ),
      },
    );

    expect(env.HOST).toBe("localhost");
    expect(env.PORT).toBe(4000);
    expect(env.BASE_URL).toBe("http://localhost:4000");
  });

  it("enforces prefix at type level", () => {
    createEnv(
      {
        PUBLIC_SITE_NAME: Env.string("PUBLIC_SITE_NAME"),
      },
      {
        prefix: "PUBLIC_",
        runtimeEnv: {
          PUBLIC_SITE_NAME: "executor",
        },
      },
    );

    // oxlint-disable-next-line no-constant-condition -- compile-time-only type check
    if (false) {
      createEnv(
        {
          // @ts-expect-error Keys must include the PUBLIC_ prefix
          SITE_NAME: Env.string("SITE_NAME"),
        },
        {
          prefix: "PUBLIC_",
          runtimeEnv: {},
        },
      );
    }

    expect(true).toBe(true);
  });
});
