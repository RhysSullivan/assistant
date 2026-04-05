import type { ComponentType } from "react";

/**
 * Contract between the shell and secret provider plugins.
 *
 * The shell owns:
 * - Secrets page layout (list of secrets, add secret dialog)
 * - Common CRUD actions
 *
 * The plugin owns:
 * - Its settings/configuration UI (rendered as a card on the Secrets page)
 * - Any setup flows (e.g. vault discovery, auth config)
 */
export interface SecretProviderPlugin {
  /** Unique key matching the SDK plugin key (e.g. "onepassword") */
  readonly key: string;

  /** Display label (e.g. "1Password", "Vault") */
  readonly label: string;

  /**
   * Settings card rendered on the Secrets page.
   * Plugin controls the entire experience inside the card.
   */
  readonly settings: ComponentType<Record<string, never>>;
}
