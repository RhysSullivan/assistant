import { describe, it, expect, beforeAll, afterAll } from "@effect/vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { loadPluginsFromJsonc } from "./load-plugins";

// Fixtures live under packages/core/config/__test-fixtures__/, which sits
// directly inside the package directory so Node's `require.resolve` walks
// up from a tmp jsonc and lands on
// `__test-fixtures__/node_modules/@loader-fixture/...`. The hand-managed
// node_modules entries declare a `./server` subpath whose default export
// matches the loader's expectation: a function `(options) => Plugin`.
const FIXTURES_ROOT = path.resolve(__dirname, "..", "__test-fixtures__");
const TMP_ROOT = path.join(FIXTURES_ROOT, "tmp");

const writeJsonc = (name: string, body: string): string => {
  const dir = fs.mkdtempSync(path.join(TMP_ROOT, `${name}-`));
  const file = path.join(dir, "executor.jsonc");
  fs.writeFileSync(file, body);
  return file;
};

beforeAll(() => {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
});

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("loadPluginsFromJsonc", () => {
  it("returns null when the jsonc file does not exist", async () => {
    const plugins = await loadPluginsFromJsonc({
      path: path.join(TMP_ROOT, "nonexistent-config.jsonc"),
    });
    expect(plugins).toBeNull();
  });

  it("returns null when the file has no `plugins` key", async () => {
    const file = writeJsonc("no-plugins-key", `{ "name": "demo" }`);
    const plugins = await loadPluginsFromJsonc({ path: file });
    expect(plugins).toBeNull();
  });

  it("returns null for an empty plugins array", async () => {
    const file = writeJsonc("empty-plugins", `{ "plugins": [] }`);
    const plugins = await loadPluginsFromJsonc({ path: file });
    expect(plugins).toBeNull();
  });

  it("throws on JSONC parse errors", async () => {
    const file = writeJsonc("parse-error", `{ "plugins": [`);
    await expect(loadPluginsFromJsonc({ path: file })).rejects.toThrow(
      /failed to parse/i,
    );
  });

  it("throws with a helpful message when the package can't be resolved", async () => {
    const file = writeJsonc(
      "unresolved",
      `{
        "plugins": [
          { "package": "@loader-fixture/does-not-exist" }
        ]
      }`,
    );
    await expect(loadPluginsFromJsonc({ path: file })).rejects.toThrow(
      /cannot resolve "@loader-fixture\/does-not-exist\/server"/,
    );
  });

  it("throws when the resolved module has no callable factory", async () => {
    const file = writeJsonc(
      "no-factory",
      `{
        "plugins": [
          { "package": "@loader-fixture/plugin-bad" }
        ]
      }`,
    );
    await expect(loadPluginsFromJsonc({ path: file })).rejects.toThrow(
      /did not export a default[\s\S]*definePlugin/,
    );
  });

  it("loads a plugin and exposes the package's id + packageName", async () => {
    const file = writeJsonc(
      "happy-path",
      `{
        "plugins": [
          { "package": "@loader-fixture/plugin-alpha" }
        ]
      }`,
    );
    const plugins = await loadPluginsFromJsonc({ path: file });
    expect(plugins).not.toBeNull();
    expect(plugins).toHaveLength(1);
    const [alpha] = plugins! as unknown as ReadonlyArray<Record<string, unknown>>;
    expect(alpha!.id).toBe("alpha");
    expect(alpha!.packageName).toBe("@loader-fixture/plugin-alpha");
  });

  it("forwards merged deps + options to the factory; entry options win on conflict", async () => {
    const file = writeJsonc(
      "merge-options",
      `{
        "plugins": [
          {
            "package": "@loader-fixture/plugin-alpha",
            "options": { "from": "options", "shared": "options-wins" }
          }
        ]
      }`,
    );
    const plugins = await loadPluginsFromJsonc({
      path: file,
      deps: { from: "deps", shared: "deps-loses", onlyDep: 42 },
    });
    const [alpha] = plugins! as unknown as ReadonlyArray<{
      __optionsReceived: Record<string, unknown>;
    }>;
    expect(alpha!.__optionsReceived).toEqual({
      from: "options",
      shared: "options-wins",
      onlyDep: 42,
    });
  });

  it("calls the factory with deps only when no options are declared", async () => {
    const file = writeJsonc(
      "deps-only",
      `{
        "plugins": [
          { "package": "@loader-fixture/plugin-alpha" }
        ]
      }`,
    );
    const plugins = await loadPluginsFromJsonc({
      path: file,
      deps: { configFile: "stub-sink" },
    });
    const [alpha] = plugins! as unknown as ReadonlyArray<{
      __optionsReceived: Record<string, unknown>;
    }>;
    expect(alpha!.__optionsReceived).toEqual({ configFile: "stub-sink" });
  });

  it("loads multiple plugins in declared order", async () => {
    const file = writeJsonc(
      "ordered",
      `{
        "plugins": [
          { "package": "@loader-fixture/plugin-beta" },
          { "package": "@loader-fixture/plugin-alpha" }
        ]
      }`,
    );
    const plugins = await loadPluginsFromJsonc({ path: file });
    expect(plugins).toHaveLength(2);
    const ids = (plugins as unknown as ReadonlyArray<{ id: string }>).map(
      (p) => p.id,
    );
    expect(ids).toEqual(["beta", "alpha"]);
  });

  it("accepts line and block comments (jsonc semantics)", async () => {
    const file = writeJsonc(
      "jsonc-syntax",
      `{
        // pick the alpha fixture
        "plugins": [
          /* one entry */
          { "package": "@loader-fixture/plugin-alpha" }
        ]
      }`,
    );
    const plugins = await loadPluginsFromJsonc({ path: file });
    expect(plugins).toHaveLength(1);
  });
});
