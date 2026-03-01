# app-convex

Convex remote server app scaffold for Executor v2.

Current scaffold includes:
 Convex schema wiring lives directly in `convex/schema.ts`
 MCP HTTP endpoint at `GET/POST/DELETE /v1/mcp` via `convex/http.ts` and `convex/mcp.ts`
 runtime callback endpoint at `POST /v1/runtime/tool-call`
 control-plane source endpoints at `GET/POST /v1/workspaces/:workspaceId/sources`
 control-plane source removal endpoint at `DELETE /v1/workspaces/:workspaceId/sources/:sourceId`
 generated OpenAPI spec endpoint at `GET /v1/openapi.json`
