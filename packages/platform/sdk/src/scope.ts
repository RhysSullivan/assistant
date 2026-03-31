import type {
  ScopeId,
} from "./schema";

export type ExecutorScopeDescriptor = {
  actorScopeId?: ScopeId | null;
  metadata?: Readonly<Record<string, unknown>>;
};

export type ExecutorScopeContext = ExecutorScopeDescriptor & {
  scopeId: ScopeId;
  actorScopeId: ScopeId | null;
};
