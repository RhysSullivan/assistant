# @executor/plugin-google-discovery

Turn any [Google Discovery API](https://developers.google.com/discovery) (Calendar, Gmail, Drive, Sheets, etc.) into a set of executor tools. Handles the discovery document, OAuth flow, and per-request token binding.

## Install

```sh
bun add @executor/sdk @executor/plugin-google-discovery
# or
npm install @executor/sdk @executor/plugin-google-discovery
```

## Usage

```ts
import { createExecutor } from "@executor/sdk";
import { googleDiscoveryPlugin } from "@executor/plugin-google-discovery";

const executor = await createExecutor({
  scope: { name: "my-app" },
  plugins: [googleDiscoveryPlugin()] as const,
});

await executor.googleDiscovery.addSource({
  name: "Google Calendar",
  discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
  namespace: "calendar",
  auth: {
    kind: "oauth2",
    clientId: "...",
    redirectUrl: "...",
  },
});

const tools = await executor.tools.list();
```

## Presets

A curated set of common Google APIs is available from the `/presets` subpath:

```ts
import { googleDiscoveryPresets } from "@executor/plugin-google-discovery/presets";
```

## Using with Effect

If you're building on `@executor/sdk` (the raw Effect entry), import this plugin from its `/core` subpath instead:

```ts
import { googleDiscoveryPlugin } from "@executor/plugin-google-discovery";
```

## Status

Pre-`1.0`. APIs may still change between beta releases. Part of the [executor monorepo](https://github.com/RhysSullivan/executor).

## License

MIT
