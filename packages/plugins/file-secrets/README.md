# @executor/plugin-file-secrets

File-backed secret store for the executor. Persists secrets to a single JSON file at an XDG-compliant path so they survive between process restarts — useful for local development, CLIs, and scripts where a system keychain isn't available.

Pairs with [`@executor/sdk`](https://www.npmjs.com/package/@executor/sdk) (promise-based) or [`@executor/core`](https://www.npmjs.com/package/@executor/core) (Effect-based).

## Install

```sh
bun add @executor/sdk @executor/plugin-file-secrets
# or
npm install @executor/sdk @executor/plugin-file-secrets
```

## Usage

```ts
import { createExecutor } from "@executor/sdk";
import { fileSecretsPlugin } from "@executor/plugin-file-secrets";

const executor = await createExecutor({
  scope: { name: "my-app" },
  plugins: [fileSecretsPlugin()] as const,
});

// Write a secret — persisted to the backing file
await executor.secrets.set({
  id: "api-key",
  name: "My API Key",
  value: "secret123",
  purpose: "authentication",
});

// Read it back
const value = await executor.secrets.resolve("api-key");

// Check where it's stored
console.log("Secret file:", executor.fileSecrets.filePath);
```

Secrets written through `executor.secrets.set(...)` become available to every other plugin that resolves them, so you can (for example) store a GitHub token here and have `@executor/plugin-openapi` or `@executor/plugin-graphql` pick it up via `{ secretId, prefix }` headers.

## Effect entry point

If you're using `@executor/core` directly, import from the `/core` subpath:

```ts
import { fileSecretsPlugin } from "@executor/plugin-file-secrets/core";
```

## Security note

Secrets are stored unencrypted in a plain JSON file. Use [`@executor/plugin-keychain`](https://www.npmjs.com/package/@executor/plugin-keychain) for OS-keychain-backed storage, or [`@executor/plugin-onepassword`](https://www.npmjs.com/package/@executor/plugin-onepassword) for 1Password-backed storage when you need encryption at rest.

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
