/**
 * Public facade for TypeScript tool typechecking utilities.
 */

export {
  analyzeToolReferences,
  type ToolReferenceAnalysis,
} from "./tool-reference-analysis";

export {
  sliceOpenApiOperationsDts,
  generateToolDeclarations,
  generateToolInventory,
  type GenerateToolDeclarationOptions,
} from "./declaration-generation";

export {
  parseTsgoDiagnostics,
} from "./tsgo-engine";

export {
  typecheckCode,
} from "./typecheck-engine";

export {
  type TypecheckResult,
} from "./typecheck-contract";
