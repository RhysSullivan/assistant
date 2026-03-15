# Local Tracing

Start Jaeger locally:

```bash
bun run trace:up
```

Run the web/server dev process with tracing enabled:

```bash
EXECUTOR_TRACE_ENABLED=1 \
EXECUTOR_TRACE_SERVICE_NAME=executor-local \
EXECUTOR_TRACE_OTLP_ENDPOINT=http://127.0.0.1:4317 \
bun run dev
```

Then open Jaeger:

- UI: `http://127.0.0.1:16686/search?service=executor-local`

You can also query traces over HTTP:

```bash
curl "http://127.0.0.1:16686/api/traces?service=executor-local&limit=20"
```

Useful operations to search for:

- `source.connect.http`
- `source.catalog.sync`
- `graphql.syncCatalog`
- `graphql.introspection.fetch`
- `graphql.manifest.extract`
- `graphql.definitions.compile`
- `graphql.operations.build`
- `graphql.snapshot.build`

Stop Jaeger:

```bash
bun run trace:down
```
