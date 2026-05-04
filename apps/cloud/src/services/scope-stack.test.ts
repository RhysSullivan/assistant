import { describe, expect, it } from "@effect/vitest";

import {
  activeWriteScopeId,
  buildGlobalScopeStack,
  buildWorkspaceScopeStack,
} from "./scope-stack";

describe("buildGlobalScopeStack", () => {
  it("emits [userOrgScope, orgScope] in inner-first order", () => {
    const stack = buildGlobalScopeStack({
      userId: "u1",
      organizationId: "o1",
      organizationName: "Acme",
    });
    expect(stack.length).toBe(2);
    expect(stack[0]!.id.toString()).toBe("user_org_u1_o1");
    expect(stack[0]!.name).toBe("Me / Acme");
    expect(stack[1]!.id.toString()).toBe("org_o1");
    expect(stack[1]!.name).toBe("Acme Global");
  });
});

describe("buildWorkspaceScopeStack", () => {
  it("emits [userWorkspace, workspace, userOrg, org] in inner-first order", () => {
    const stack = buildWorkspaceScopeStack({
      userId: "u1",
      organizationId: "o1",
      organizationName: "Acme",
      workspaceId: "w1",
      workspaceName: "Billing API",
    });
    expect(stack.length).toBe(4);
    expect(stack[0]!.id.toString()).toBe("user_workspace_u1_w1");
    expect(stack[0]!.name).toBe("Me / Billing API");
    expect(stack[1]!.id.toString()).toBe("workspace_w1");
    expect(stack[1]!.name).toBe("Billing API");
    expect(stack[2]!.id.toString()).toBe("user_org_u1_o1");
    expect(stack[2]!.name).toBe("Me / Acme");
    expect(stack[3]!.id.toString()).toBe("org_o1");
    expect(stack[3]!.name).toBe("Acme Global");
  });
});

describe("activeWriteScopeId", () => {
  it("returns the org scope id in global context", () => {
    const id = activeWriteScopeId({
      userId: "u1",
      organizationId: "o1",
      organizationName: "Acme",
    });
    expect(id.toString()).toBe("org_o1");
  });

  it("returns the workspace scope id in workspace context", () => {
    const id = activeWriteScopeId({
      userId: "u1",
      organizationId: "o1",
      organizationName: "Acme",
      workspaceId: "w1",
      workspaceName: "Billing API",
    });
    expect(id.toString()).toBe("workspace_w1");
  });
});
