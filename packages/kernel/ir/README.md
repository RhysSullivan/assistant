# IR v1

`@executor/ir` is the greenfield semantic center for imported sources.

## Boundary

- `CatalogSnapshotV1` is the canonical persisted import artifact.
- `CatalogV1` is the normalized semantic graph.
- `CatalogFragmentV1` is the adapter/importer output contract.
- `ToolDescriptor`, search docs, inspect views, and `InvocationPlan` are projections.

## Direction

Importers should move toward:

`source -> CatalogFragmentV1 -> merge -> CatalogV1 -> projectors -> InvocationPlan`

The existing runtime-specific compiled payload blobs are no longer the target semantic center.

## Package Surface

Use either:

- `@executor/ir`

## Guarantees

- provenance is required on entities
- synthetic entities are marked explicitly
- lossy normalization is represented by diagnostics
- inheritance is preserved in scopes and resolved at projection/planning time
- invocation plans remain connection-bound runtime artifacts, not canonical IR
