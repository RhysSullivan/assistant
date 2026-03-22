import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  DistributionHarness,
  LocalDistributionHarnessLive,
} from "./harness";

describe("distribution flow", () => {
  const verifyInstallFlow = <R>(
    runCommand: (
      args: ReadonlyArray<string>,
      options?: {
        readonly okExitCodes?: ReadonlyArray<number>;
      },
    ) => Effect.Effect<{ stdout: string; stderr: string }, Error, R>,
  ) =>
    Effect.gen(function* () {
      const harness = yield* DistributionHarness;

      yield* harness.writeProjectConfig(`{
  "runtime": "ses",
  // local workspace config
  "sources": {},
}
`);

      const initialDoctor = yield* runCommand([
        "doctor",
        "--json",
        "--base-url",
        harness.baseUrl,
      ]);
      const initialDoctorJson = JSON.parse(initialDoctor.stdout) as {
        ok: boolean;
        checks: Record<string, { ok: boolean }>;
      };
      expect(initialDoctorJson.ok).toBe(false);
      expect(initialDoctorJson.checks.webAssets?.ok).toBe(true);
      expect(initialDoctorJson.checks.database?.ok).toBe(true);

      yield* runCommand(["up", "--base-url", harness.baseUrl]);

      const statusResult = yield* runCommand([
        "status",
        "--json",
        "--base-url",
        harness.baseUrl,
      ]);
      const status = JSON.parse(statusResult.stdout) as {
        reachable: boolean;
        pidRunning: boolean;
        installation: { workspaceId: string; accountId: string } | null;
      };

      expect(status.reachable).toBe(true);
      expect(status.pidRunning).toBe(true);
      expect(status.installation).not.toBeNull();

      const html = yield* harness.fetchText("/");
      expect(html.status).toBe(200);
      expect(html.contentType).toContain("text/html");
      expect(html.body).toContain("<div id=\"root\"></div>");

      const installationResponse = yield* harness.fetchText("/v1/local/installation");
      expect(installationResponse.status).toBe(200);
      const installation = JSON.parse(installationResponse.body) as {
        scopeId: string;
        actorScopeId: string;
      };

      const sesCall = yield* runCommand(
        [
          "call",
          'await fetch("https://example.com"); return 1;',
          "--base-url",
          harness.baseUrl,
        ],
        { okExitCodes: [1] },
      );
      expect(sesCall.stderr).toContain("fetch is disabled in SES executor");

      yield* runCommand(["down", "--base-url", harness.baseUrl]);
      yield* runCommand(["up", "--base-url", harness.baseUrl]);

      const installationAfterRestartResponse = yield* harness.fetchText("/v1/local/installation");
      expect(installationAfterRestartResponse.status).toBe(200);
      const installationAfterRestart = JSON.parse(
        installationAfterRestartResponse.body,
      ) as {
        scopeId: string;
        actorScopeId: string;
      };

      expect(installationAfterRestart.scopeId).toBe(installation.scopeId);
      expect(installationAfterRestart.actorScopeId).toBe(installation.actorScopeId);

      yield* runCommand(["down", "--base-url", harness.baseUrl]);
    });

  it.live("boots a staged package artifact in a fresh home", () =>
    verifyInstallFlow((args, options) =>
      Effect.flatMap(DistributionHarness, (harness) => harness.run(args, options))
    )
      .pipe(Effect.provide(LocalDistributionHarnessLive)), 240_000);

  it.live("boots an npm-installed package in a fresh home", () =>
    verifyInstallFlow((args, options) =>
      Effect.flatMap(DistributionHarness, (harness) => harness.runInstalled(args, options))
    ).pipe(Effect.provide(LocalDistributionHarnessLive)), 240_000);
});
