import { type Plugin } from "@executor/sdk/core";

import {
  fileSecretsPlugin as fileSecretsPluginEffect,
  type FileSecretsExtension,
  type FileSecretsPluginConfig,
} from "./index";

export type { FileSecretsPluginConfig } from "./index";

// Explicit return type so the emitted dist/promise.d.ts references
// `import("@executor/sdk/core").Plugin` (where `Plugin` lives) rather than
// `import("@executor/sdk").Plugin` (the Promise surface, which doesn't
// re-export Plugin). The publish-time scope rename rewrites
// `@executor/sdk/core` to `@executor-js/sdk/core` consistently.
export const fileSecretsPlugin = (
  config?: FileSecretsPluginConfig,
): Plugin<"fileSecrets", FileSecretsExtension, Record<string, never>, undefined> =>
  fileSecretsPluginEffect(config);
