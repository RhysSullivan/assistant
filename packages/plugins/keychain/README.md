# @executor-js/plugin-keychain

OS-keychain-backed secret store for the executor. Reads and writes secrets to:

- **macOS / iOS** — Keychain
- **Linux** — Secret Service (GNOME Keyring, KWallet)
- **Windows** — Credential Manager

Secrets are encrypted at rest by the operating system and never touch your project's filesystem.

## Install

```sh
bun add @executor-js/sdk @executor-js/plugin-keychain
# or
npm install @executor-js/sdk @executor-js/plugin-keychain
```

## Usage

```ts
import { createExecutor } from "@executor-js/sdk";
import { keychainPlugin } from "@executor-js/plugin-keychain";

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

Secrets written through this plugin are available to every other plugin that resolves secrets by ID — so you can store a token once and use it across `@executor-js/plugin-openapi`, `@executor-js/plugin-graphql`, etc. via `{ secretId, prefix }` headers.

## Using with Effect

If you're building on `@executor-js/sdk` (the raw Effect entry), import this plugin from its `/core` subpath instead:

```ts
import { keychainPlugin } from "@executor-js/plugin-keychain";
```

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
