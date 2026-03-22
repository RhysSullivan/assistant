import {
  describe,
  expect,
  it,
} from "@effect/vitest";

import type {
  LocalScopePolicy,
} from "#schema";
import {
  PolicyIdSchema,
  SourceIdSchema,
  ScopeIdSchema,
} from "#schema";

import {
  evaluateInvocationPolicy,
  type InvocationDescriptor,
} from "./invocation-policy-engine";

const scopeId = ScopeIdSchema.make("ws_policy_engine");
const sourceId = SourceIdSchema.make("src_policy_engine");

const now = 1_700_000_000_000;

const baseDescriptor: InvocationDescriptor = {
  toolPath: "vercel.api.dns.createRecord",
  sourceId,
  sourceName: "Vercel",
  sourceKind: "openapi",
  sourceNamespace: "vercel.api.dns",
  operationKind: "write",
  interaction: "required",
  approvalLabel: "POST /v10/domains/{domain}/records",
};

const basePolicy = (
  patch: Partial<LocalScopePolicy> = {},
): LocalScopePolicy => ({
  id: PolicyIdSchema.make(`pol_${Math.random().toString(36).slice(2, 8)}`),
  key: "vercel-dns",
  scopeId,
  resourcePattern: "vercel.api.dns.createRecord",
  effect: "allow",
  approvalMode: "auto",
  priority: 0,
  enabled: true,
  createdAt: now,
  updatedAt: now,
  ...patch,
});

describe("invocation-policy-engine", () => {
  it("allows read requests by default", () => {
    const decision = evaluateInvocationPolicy({
      descriptor: {
        ...baseDescriptor,
        toolPath: "vercel.api.dns.getRecords",
        operationKind: "read",
        interaction: "auto",
        approvalLabel: "GET /v4/domains/{domain}/records",
      },
      args: {},
      policies: [],
      context: {
        scopeId,
      },
    });

    expect(decision.kind).toBe("allow");
  });

  it("requires interaction for mutating requests by default", () => {
    const decision = evaluateInvocationPolicy({
      descriptor: baseDescriptor,
      args: { domain: "testing.executor.sh" },
      policies: [],
      context: {
        scopeId,
      },
    });

    expect(decision.kind).toBe("require_interaction");
  });

  it("allows a mutating request when a matching policy exists", () => {
    const decision = evaluateInvocationPolicy({
      descriptor: baseDescriptor,
      args: { domain: "testing.executor.sh" },
      policies: [basePolicy({
        id: PolicyIdSchema.make("pol_allow"),
      })],
      context: {
        scopeId,
      },
    });

    expect(decision.kind).toBe("allow");
    expect(decision.matchedPolicyId).toBe("pol_allow");
  });

  it("prefers a more specific deny over a broad allow", () => {
    const decision = evaluateInvocationPolicy({
      descriptor: baseDescriptor,
      args: { domain: "testing.executor.sh" },
      policies: [
        basePolicy({
          id: PolicyIdSchema.make("pol_allow_all_vercel"),
          key: "allow-all-vercel",
          resourcePattern: "vercel.api.*",
          effect: "allow",
          priority: 0,
        }),
        basePolicy({
          id: PolicyIdSchema.make("pol_deny_create_record"),
          key: "deny-create-record",
          effect: "deny",
          priority: 1,
        }),
      ],
      context: {
        scopeId,
      },
    });

    expect(decision.kind).toBe("deny");
    expect(decision.matchedPolicyId).toBe("pol_deny_create_record");
  });

  it("ignores disabled policies", () => {
    const decision = evaluateInvocationPolicy({
      descriptor: baseDescriptor,
      args: { domain: "testing.executor.sh" },
      policies: [basePolicy({
        id: PolicyIdSchema.make("pol_disabled"),
        enabled: false,
      })],
      context: {
        scopeId,
      },
    });

    expect(decision.kind).toBe("require_interaction");
    expect(decision.matchedPolicyId).toBeNull();
  });
});
