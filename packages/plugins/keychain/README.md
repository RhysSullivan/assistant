# @executor/plugin-keychain

OS-keychain-backed secret store for the executor. Reads and writes secrets to:

- **macOS / iOS** — Keychain
- **Linux** — Secret Service (GNOME Keyring, KWallet)
- **Windows** — Credential Manager

Secrets are encrypted at rest by the operating system and never touch your project's filesystem.

Pairs with [`@executor/sdk`](https://www.npmjs.com/package/@executor/sdk) (promise-based) or [`@executor/core`](https://www.npmjs.com/package/@executor/core) (Effect-based).

## Install

```sh
bun add @executor/sdk @executor/plugin-keychain
# or
npm install @executor/sdk @executor/plugin-keychain
```

## Usage

```ts
import { createExecutor } from "@executor/sdk";
import { keychainPlugin } from "@executor/plugin-keychain";

const executor = await createExecutor({
  scope: { name: "my-app" },
  plugins: [keychainPlugin()] as const,
});

// Check whether the current OS has a supported keychain
if (executor.keychain.isSupported) {
  await executor.secrets.set({
    id: "github-token",
    name: "GitHub Token",
    value: "ghp_...",
    purpose: "authentication",
  });

  const value = await executor.secrets.resolve("github-token");
}
```

Secrets written through this plugin are available to every other plugin that resolves secrets by ID — so you can store a token once and use it across `@executor/plugin-openapi`, `@executor/plugin-graphql`, etc. via `{ secretId, prefix }` headers.

## Effect entry point

If you're using `@executor/core` directly, import from the `/core` subpath:

```ts
import { keychainPlugin } from "@executor/plugin-keychain/core";
```

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
