import type { WorkOS } from "@workos-inc/node/worker";

export interface WorkOSVaultObjectMetadata {
  readonly context: Record<string, unknown>;
  readonly id: string;
  readonly updatedAt: Date;
  readonly versionId: string;
}

export interface WorkOSVaultObject {
  readonly id: string;
  readonly metadata: WorkOSVaultObjectMetadata;
  readonly name: string;
  readonly value?: string;
}

export interface WorkOSVaultClient {
  readonly createObject: (options: {
    readonly name: string;
    readonly value: string;
    readonly context: Record<string, string>;
  }) => Promise<WorkOSVaultObjectMetadata>;
  readonly readObjectByName: (name: string) => Promise<WorkOSVaultObject>;
  readonly updateObject: (options: {
    readonly id: string;
    readonly value: string;
    readonly versionCheck?: string;
  }) => Promise<WorkOSVaultObject>;
  readonly deleteObject: (options: { readonly id: string }) => Promise<void>;
}

export const makeWorkOSVaultClient = (
  workos: Pick<WorkOS, "vault">,
): WorkOSVaultClient => ({
  createObject: (options) => workos.vault.createObject(options),
  readObjectByName: (name) => workos.vault.readObjectByName(name),
  updateObject: (options) => workos.vault.updateObject(options),
  deleteObject: (options) => workos.vault.deleteObject(options),
});
