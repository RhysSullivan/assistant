import type {
  LocalScopePolicy,
  Source,
} from "#schema";

export type InvocationOperationKind =
  | "read"
  | "write"
  | "delete"
  | "execute"
  | "unknown";

export type InvocationDescriptor = {
  toolPath: string;
  sourceId: Source["id"];
  sourceName: Source["name"];
  sourceKind: Source["kind"];
  sourceNamespace: string | null;
  operationKind: InvocationOperationKind;
  interaction: "auto" | "required";
  approvalLabel: string | null;
};

export type InvocationPolicyContext = {
  scopeId: LocalScopePolicy["scopeId"];
};

export type InvocationAuthorizationDecision = {
  kind: "allow" | "deny" | "require_interaction";
  reason: string;
  matchedPolicyId: LocalScopePolicy["id"] | null;
};

const matchesGlob = (pattern: string, value: string): boolean => {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
};

const policySpecificity = (policy: LocalScopePolicy): number =>
  policy.priority + Math.max(1, policy.resourcePattern.replace(/\*/g, "").length);

const defaultDecisionForInvocation = (
  descriptor: InvocationDescriptor,
): InvocationAuthorizationDecision => {
  if (descriptor.interaction === "auto") {
    return {
      kind: "allow",
      reason: `${descriptor.approvalLabel ?? descriptor.toolPath} defaults to allow`,
      matchedPolicyId: null,
    };
  }

  return {
    kind: "require_interaction",
    reason: `${descriptor.approvalLabel ?? descriptor.toolPath} defaults to approval`,
    matchedPolicyId: null,
  };
};

const resolvePolicyDecision = (
  policy: LocalScopePolicy,
): InvocationAuthorizationDecision => {
  if (policy.effect === "deny") {
    return {
      kind: "deny",
      reason: `Denied by policy ${policy.id}`,
      matchedPolicyId: policy.id,
    };
  }

  if (policy.approvalMode === "required") {
    return {
      kind: "require_interaction",
      reason: `Approval required by policy ${policy.id}`,
      matchedPolicyId: policy.id,
    };
  }

  return {
    kind: "allow",
    reason: `Allowed by policy ${policy.id}`,
    matchedPolicyId: policy.id,
  };
};

export const evaluateInvocationPolicy = (input: {
  descriptor: InvocationDescriptor;
  args: unknown;
  policies: ReadonlyArray<LocalScopePolicy>;
  context: InvocationPolicyContext;
}): InvocationAuthorizationDecision => {
  const matchingPolicies = input.policies
    .filter((policy) =>
      policy.enabled
      && policy.scopeId === input.context.scopeId
      && matchesGlob(policy.resourcePattern, input.descriptor.toolPath))
    .sort((left, right) =>
      policySpecificity(right) - policySpecificity(left)
      || left.updatedAt - right.updatedAt,
    );

  const matched = matchingPolicies[0];
  return matched ? resolvePolicyDecision(matched) : defaultDecisionForInvocation(input.descriptor);
};
