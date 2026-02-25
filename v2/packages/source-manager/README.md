# source-manager

Dynamic source registration scaffold for Executor v2.

Current scaffold includes:
- OpenAPI tool extraction in `src/openapi-extraction.ts`
- Incremental manifest diffing (`added`, `changed`, `removed`, `unchangedCount`)
- Artifact refresh orchestration via `refreshOpenApiArtifact`
- service-based access via `SourceManager` and `SourceManagerLive`
