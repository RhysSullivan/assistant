export interface TypecheckResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export const TYPECHECK_OK: TypecheckResult = { ok: true, errors: [] };
