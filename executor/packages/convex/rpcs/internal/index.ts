// Intentionally empty.
//
// Convex function discovery is file-based and can be confused by barrel re-exports
// that aggregate `internalQuery`/`internalMutation`/`internalAction` exports into a
// different module.
// Keep the RPC declarations in sibling files under this directory.
export {};
export * as database from "./database";
