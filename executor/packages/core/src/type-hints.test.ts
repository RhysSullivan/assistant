import { expect, test } from "bun:test";
import {
  compactArgKeysHint,
  compactArgTypeHint,
  compactArgDisplayHint,
  compactDescriptionLine,
  compactReturnTypeHint,
  llmExpandedArgShapeHint,
  extractTopLevelTypeKeys,
} from "./type-hints";

test("extractTopLevelTypeKeys handles nested object literals", async () => {
  const keys = extractTopLevelTypeKeys("{ parent: { title: string }; icon?: { emoji: string }; children: string[] }");
  expect(keys).toEqual(["parent", "icon", "children"]);
});

test("compactArgTypeHint keeps only top-level previews", async () => {
  const compact = compactArgTypeHint(
    "{ parent: { database_id: string }; title: Array<{ text: { content: string } }>; icon?: { emoji: string }; properties?: Record<string, unknown> }",
  );
  expect(compact).toBe("{ parent: ...; title: ...; icon: ...; properties: ... }");
});

test("compactArgTypeHint flattens simple object intersections", async () => {
  const compact = compactArgTypeHint(
    "{ owner: string; repo: string; runner_id: number } & { labels: string[] }",
  );
  expect(compact).toBe("{ owner: string; repo: string; runner_id: number; labels: string[] }");
});

test("compactArgTypeHint handles parenthesized object intersections", async () => {
  const compact = compactArgTypeHint(
    '{ org: string } & ({ enabled_repositories: "all" | "selected" | "none" })',
  );
  expect(compact).toBe('{ org: string; enabled_repositories: "all" | "selected" | "none" }');
});

test("compactArgTypeHint flattens intersection chains of parenthesized objects", async () => {
  const compact = compactArgTypeHint(
    '({ org: string }) & ({ owner: string }) & ({ repo: string })',
  );
  expect(compact).toBe('{ org: string; owner: string; repo: string }');
});

test("compactArgTypeHint strips quotes when flattening quoted keys", async () => {
  const compact = compactArgTypeHint(
    '{ org: string } & ({ "enabled_repositories": "all" | "selected" | "none" })',
  );
  expect(compact).toBe('{ org: string; enabled_repositories: "all" | "selected" | "none" }');
});

test("compactArgTypeHint unwraps fully parenthesized intersections", async () => {
  const compact = compactArgTypeHint('(({ org: string }) & ({ owner: string }))');
  expect(compact).toBe('{ org: string; owner: string }');
});

test("compactArgTypeHint does not flatten mixed object and scalar intersections", async () => {
  const compact = compactArgTypeHint('{ org: string } & ({ enabled_repositories: "all" | "selected" | "none" }) & string');
  expect(compact).toBe('{ org: string } & ({ enabled_repositories: "all" | "selected" | "none" }) & string');
});

test("compactArgTypeHint truncates long object-and-array intersections", async () => {
  const compact = compactArgTypeHint('{ "x-artifact-client-ci"?: string; "x-artifact-client-interactive"?: number; teamId?: string; slug?: string } & (({ sessionId: string; source: "LOCAL" | "REMOTE"; event: "HIT" | "MISS"; hash: string; duration?: number }[])');
  expect(compact.startsWith('{ "x-artifact-client-ci"?: string; "x-artifact-client-interactive"?: number; teamId?: string; slug?: string } & (({ s')).toBe(true);
  expect(compact.endsWith('...')).toBe(true);
  expect(compact.length).toBeLessThanOrEqual(120);
});

test("compactArgTypeHint truncates long intersected object lists", async () => {
  const compact = compactArgTypeHint('{ a: string } & ({ b: string }) & ({ c: string }) & ({ d: string }) & ({ e: string }) & ({ f: string }) & ({ g: string }) & ({ h: string }) & ({ i: string })');
  expect(compact).toMatch(/^\{ a: string \} & \(\{ b: string \}\) \& \(\{ c: string \}\) \& \(\{ d: string \}\) \& \(\{ e: string \}\) \& \(\{ f: string \}\) \& \(\{ g: strin\.\.\.\)?$/);
  expect(compact.length).toBeLessThanOrEqual(120);
});

test("compactArgTypeHint dedupes trivial unions while preserving concrete types", async () => {
  const compact = compactArgTypeHint("{ app_id: string | string; account_id: string }");
  expect(compact).toBe("{ app_id: string; account_id: string }");
});

test("compactArgDisplayHint uses preview keys when compacted to key-list", async () => {
  const argsType = `{ ${Array.from({ length: 20 }, (_, i) => `long_key_name_${i}: { nested: { nested: string } }`).join("; ")} }`;
  const compact = compactArgDisplayHint(argsType, ["owner", "repo", "cursor", "per_page"]);
  expect(compact).toBe("{ owner: ...; repo: ...; cursor: ...; per_page: ... }");
});

test("compactArgKeysHint caps key list with ellipsis", async () => {
  const compact = compactArgKeysHint(["a", "b", "c", "d", "e", "f", "g", "h"]);
  expect(compact).toBe("{ a: ...; b: ...; c: ...; d: ...; e: ...; f: ...; ... }");
});

test("compactReturnTypeHint collapses graphql envelopes", async () => {
  const compact = compactReturnTypeHint("{ data: { issue: { id: string; title: string } }; errors: unknown[] }");
  expect(compact).toBe("{ data: ...; errors: unknown[] }");
});

test("compactReturnTypeHint flattens simple object intersections", async () => {
  const compact = compactReturnTypeHint(
    "{ errors: { code: number }[]; messages: { code: number }[]; success: true } & { result?: { id?: string } }",
  );
  expect(compact).toBe(
    "{ errors: { code: number }[]; messages: { code: number }[]; success: true; result?: { id?: string } }",
  );
});

test("compactReturnTypeHint keeps graphql envelope compaction", async () => {
  const compact = compactReturnTypeHint('{ data: { id: string } } & ({ errors: { code: number } })');
  expect(compact).toBe('{ data: ...; errors: unknown[] }');
});

test("compactReturnTypeHint unwraps fully parenthesized envelopes", async () => {
  const compact = compactReturnTypeHint('(({ data: { id: string } }) & ({ errors: { code: number } }))');
  expect(compact).toBe('{ data: ...; errors: unknown[] }');
});

test("compactReturnTypeHint truncates object-and-array intersections", async () => {
  const compact = compactReturnTypeHint('{ "x-artifact-client-ci"?: string; "x-artifact-client-interactive"?: number; teamId?: string; slug?: string } & (({ sessionId: string; source: "LOCAL" | "REMOTE"; event: "HIT" | "MISS"; hash: string; duration?: number }[])');
  expect(compact.startsWith('{ "x-artifact-client-ci"?: string; "x-artifact-client-interactive"?: number; teamId?: string; slug?: string } & (')).toBe(true);
  expect(compact.endsWith('...')).toBe(true);
  expect(compact.length).toBeLessThanOrEqual(130);
});

test("compactReturnTypeHint truncates huge trailing array hints", async () => {
  const compact = compactReturnTypeHint(`${"x".repeat(95)}[]`);
  expect(compact).toBe("Array<...>");
});

test("compactDescriptionLine trims to a single concise line", async () => {
  const compact = compactDescriptionLine("Create a database in Notion.\nThis endpoint supports parent/page context.");
  expect(compact).toBe("Create a database in Notion.");
});

test("llmExpandedArgShapeHint keeps concise inline object signatures", async () => {
  const compact = llmExpandedArgShapeHint("{ owner: string; repo: string }");
  expect(compact).toBe("{ owner: string; repo: string }");
});
