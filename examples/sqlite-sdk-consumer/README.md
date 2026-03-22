# SQLite SDK Consumer Example

This example shows how an embedder can implement a custom SQLite-backed adapter
using the public Promise-facing `@executor/platform-sdk`.

The adapter is intentionally simple:

- installation state is stored in SQLite
- scope config and scope state are stored in SQLite
- source artifacts are stored in SQLite
- executor state is stored in SQLite
- secret material is stored in SQLite

There is no direct `effect` usage in the example.

## Run

```sh
bun run --cwd examples/sqlite-sdk-consumer start
```

To keep the demo ephemeral:

```sh
DATABASE_PATH=:memory: bun run --cwd examples/sqlite-sdk-consumer start
```

## Shape

The important bit is the consumer-facing construction:

```ts
import { createExecutor } from "@executor/platform-sdk";
import { createSqliteExecutorBackend } from "@executor/sqlite-sdk-consumer-example";

const executor = await createExecutor({
  backend: createSqliteExecutorBackend({
    databasePath: "./executor.sqlite",
    scopeName: "Acme",
  }),
});
```
