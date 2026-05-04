import { describe, expect, it } from "@effect/vitest";

import {
  newId,
  orgScopeId,
  slugifyHandle,
  userOrgScopeId,
  userWorkspaceScopeId,
  withHandleSuffix,
  workspaceScopeId,
} from "./ids";

describe("newId", () => {
  it("emits prefix + base58 body", () => {
    const id = newId("workspace");
    expect(id.startsWith("workspace_")).toBe(true);
    const body = id.slice("workspace_".length);
    expect(body).toMatch(/^[1-9A-HJ-NP-Za-km-z]{22}$/);
  });

  it("collides with negligible probability across 1k draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newId("workspace"));
    expect(seen.size).toBe(1000);
  });
});

describe("scope id constructors", () => {
  it("orgScopeId formats org_<id>", () => {
    expect(orgScopeId("org_abc").toString()).toBe("org_org_abc");
    expect(orgScopeId("01H").toString()).toBe("org_01H");
  });

  it("workspaceScopeId formats workspace_<id>", () => {
    expect(workspaceScopeId("ws_abc").toString()).toBe("workspace_ws_abc");
  });

  it("userOrgScopeId formats user_org_<userId>_<orgId>", () => {
    expect(userOrgScopeId("u1", "o1").toString()).toBe("user_org_u1_o1");
  });

  it("userWorkspaceScopeId formats user_workspace_<userId>_<workspaceId>", () => {
    expect(userWorkspaceScopeId("u1", "w1").toString()).toBe(
      "user_workspace_u1_w1",
    );
  });
});

describe("slugifyHandle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyHandle("Acme Corp")).toBe("acme-corp");
  });

  it("collapses runs and trims edges", () => {
    expect(slugifyHandle("  --Acme!!  Corp__  ")).toBe("acme-corp");
  });

  it("strips diacritics", () => {
    expect(slugifyHandle("Café Münchën")).toBe("cafe-munchen");
  });

  it("falls back to 'org' for empty results", () => {
    expect(slugifyHandle("!!!")).toBe("org");
    expect(slugifyHandle("")).toBe("org");
  });

  it("caps length at 48", () => {
    const long = "a".repeat(120);
    expect(slugifyHandle(long).length).toBe(48);
  });
});

describe("withHandleSuffix", () => {
  it("appends -n", () => {
    expect(withHandleSuffix("acme", 2)).toBe("acme-2");
    expect(withHandleSuffix("acme", 17)).toBe("acme-17");
  });

  it("keeps total length <= 48 by truncating the base", () => {
    const base = "a".repeat(48);
    const out = withHandleSuffix(base, 9);
    expect(out.length).toBe(48);
    expect(out.endsWith("-9")).toBe(true);
  });
});
