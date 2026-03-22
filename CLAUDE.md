# Repo Agent Notes

- When a test needs an OpenAPI spec, generate it from Effect `HttpApi` with `OpenApi.fromApi(...)`.
- When a test needs to serve an Effect `HttpApi` plus `/openapi.json`, use `@executor/effect-test-utils` via `startOpenApiTestServer(...)` or `makeOpenApiTestServer(...)`.
- Do not hand-author inline OpenAPI documents in normal tests.
- Do not hand-roll `HttpApiBuilder.toWebHandler(...)` to Node HTTP bridges for OpenAPI test servers.
- Raw OpenAPI parser/import-fidelity tests are the exception; those may keep literal OpenAPI documents where the point of the test is the raw document itself.
