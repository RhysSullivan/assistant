# OTel Tracing For Source Connect

## Setup

- Use the Effect-native OTel layer from `@effect/opentelemetry`, not a hand-rolled tracer bridge.
- Start Jaeger with `bun run trace:up`.
- Run the dev server with:

```bash
EXECUTOR_TRACE_ENABLED=1 \
EXECUTOR_TRACE_SERVICE_NAME=executor-local \
EXECUTOR_TRACE_OTLP_ENDPOINT=http://127.0.0.1:4317 \
bun run dev
```

- Query traces via:

```bash
curl "http://127.0.0.1:16686/api/traces?service=executor-local&limit=20"
```

## Useful spans

- `source.connect.http`
- `source.catalog.sync`
- `source.store.persist`
- `source.store.load_by_id`
- `source.status.update`
- `graphql.syncCatalog`
- `graphql.introspection.fetch`
- `graphql.manifest.extract`
- `graphql.definitions.compile`
- `graphql.operations.build`
- `graphql.snapshot.build`

## What the traces showed

- Raw Linear introspection fetch is fast, around sub-second to about one second.
- The biggest remaining cost in the GraphQL import path is `graphql.operations.build`, around 5s on Linear.
- A large earlier regression was not GraphQL import itself. It was declaration refresh churn interfering with the connect flow.
- The fix was:
  - keep `.d.ts` generation backgrounded
  - debounce it with Effect fibers / `Effect.sleep`
  - avoid scheduling workspace-wide declaration refresh during normal `probing` / `connected` source persists

## Current state

- Fresh Linear `connect` is back down to about 7-8s instead of ~70s.
- `linear.d.ts` is much smaller now because source-level shared shapes are deduped.
- The next performance target is `graphql.operations.build`, not tracing or `.d.ts` scheduling.
