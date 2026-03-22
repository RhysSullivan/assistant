import type {
  ScopeId,
} from "./schema";

export type ExecutorScopeDescriptor = {
  scopeName: string;
  scopeRoot?: string | null;
  actorScopeId?: ScopeId | null;
  resolutionScopeIds?: ReadonlyArray<ScopeId>;
  metadata?: Readonly<Record<string, unknown>>;
};

export type ExecutorScopeContext = ExecutorScopeDescriptor & {
  scopeId: ScopeId;
  actorScopeId: ScopeId | null;
  resolutionScopeIds: ReadonlyArray<ScopeId>;
};
