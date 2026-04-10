# @executor/plugin-graphql

Introspect a GraphQL endpoint and expose its queries and mutations as invokable tools on an executor.

## Install

```sh
bun add @executor/sdk @executor/plugin-graphql
# or
npm install @executor/sdk @executor/plugin-graphql
```

## Usage

```ts
import { createExecutor } from "@executor/sdk";
import { graphqlPlugin } from "@executor/plugin-graphql";

const executor = await createExecutor({
  scope: { name: "my-app" },
  plugins: [graphqlPlugin()] as const,
});

// Public endpoint — no auth
await executor.graphql.addSource({
  endpoint: "https://graphql.anilist.co",
  namespace: "anilist",
});

const tools = await executor.tools.list();
const result = await executor.tools.invoke(
  "anilist.Media",
  { search: "Frieren" },
  { onElicitation: "accept-all" },
);
```

## Secret-backed auth

```ts
await executor.secrets.set({
  id: "github-token",
  name: "GitHub Token",
  value: "ghp_...",
  purpose: "authentication",
});

await executor.graphql.addSource({
  endpoint: "https://api.github.com/graphql",
  namespace: "github",
  headers: {
    Authorization: { secretId: "github-token", prefix: "Bearer " },
  },
});
```

## Using with Effect

If you're building on `@executor/sdk` (the raw Effect entry), import this plugin from its `/core` subpath instead:

```ts
import { graphqlPlugin } from "@executor/plugin-graphql";
```

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
