# @executor/plugin-graphql

Introspect a GraphQL endpoint and expose its queries and mutations as invokable tools on an executor.

Pairs with [`@executor/sdk`](https://www.npmjs.com/package/@executor/sdk) (promise-based) or [`@executor/core`](https://www.npmjs.com/package/@executor/core) (Effect-based).

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

## Effect entry point

If you're using `@executor/core` directly, import from the `/core` subpath:

```ts
import { graphqlPlugin } from "@executor/plugin-graphql/core";
```

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
