import { useEffect, useState } from "react";

import {
  getExecutorApiBaseUrl,
  useExecutorMutation,
  useWorkspaceRequestContext,
} from "@executor/react";
import type {
  SecretStoreCreateFormProps,
} from "@executor/react/plugins";
import {
  Alert,
  Button,
  Input,
  Label,
  Select,
} from "@executor/react/plugins";
import {
  type OnePasswordDiscoverVaultsInput,
  type OnePasswordDiscoverVaultsResult,
  type OnePasswordStoreAuth,
  type OnePasswordVault,
} from "@executor/plugin-onepassword-shared";


export function OnePasswordSecretStoreCreateForm(
  props: SecretStoreCreateFormProps,
) {
  const workspace = useWorkspaceRequestContext();
  const [name, setName] = useState("");
  const [authKind, setAuthKind] = useState<"desktop-app" | "service-account">(
    "desktop-app",
  );
  const [accountName, setAccountName] = useState("");
  const [vaultId, setVaultId] = useState("");
  const [tokenSecretId, setTokenSecretId] = useState("");
  const [discoveredVaults, setDiscoveredVaults] = useState<ReadonlyArray<OnePasswordVault>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const discoverVaultsMutation = useExecutorMutation<
    OnePasswordDiscoverVaultsInput,
    OnePasswordDiscoverVaultsResult
  >(async (payload) => {
    if (!workspace.enabled) {
      throw new Error("Workspace is still loading.");
    }

    const response = await fetch(
      `${getExecutorApiBaseUrl()}/v1/workspaces/${workspace.workspaceId}/plugins/onepassword/vaults/discover`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      let message = "Failed loading 1Password vaults.";
      try {
        const responseError = await response.json() as {
          message?: string;
          details?: string;
        };
        message = responseError.message ?? responseError.details ?? message;
      } catch {
        // ignore response parsing errors
      }
      throw new Error(message);
    }

    return await response.json() as OnePasswordDiscoverVaultsResult;
  });

  useEffect(() => {
    setDiscoveredVaults([]);
    discoverVaultsMutation.reset();
  }, [accountName, authKind, discoverVaultsMutation.reset, tokenSecretId]);

  const onePasswordAuth = (): OnePasswordStoreAuth | null => {
    if (authKind === "desktop-app") {
      const trimmedAccountName = accountName.trim();
      if (!trimmedAccountName) {
        return null;
      }

      return {
        kind: "desktop-app",
        accountName: trimmedAccountName,
      };
    }

    if (!tokenSecretId) {
      return null;
    }

    return {
      kind: "service-account",
      tokenSecretRef: {
        secretId: tokenSecretId as Extract<
          OnePasswordStoreAuth,
          { kind: "service-account" }
        >["tokenSecretRef"]["secretId"],
      },
    };
  };

  const handleDiscoverVaults = async () => {
    setError(null);

    const auth = onePasswordAuth();
    if (!auth) {
      setError(
        authKind === "desktop-app"
          ? "Enter your 1Password account name before loading vaults."
          : "Select a service-account token secret before loading vaults.",
      );
      return;
    }

    try {
      const result = await discoverVaultsMutation.mutateAsync({ auth });
      setDiscoveredVaults(result.vaults);
      if (!vaultId.trim() && result.vaults.length > 0) {
        setVaultId(result.vaults[0]!.id);
      }
      if (result.vaults.length === 0) {
        setError("No accessible vaults were returned for this 1Password account.");
      }
    } catch (cause) {
      setDiscoveredVaults([]);
      setError(
        cause instanceof Error ? cause.message : "Failed loading 1Password vaults.",
      );
    }
  };

  const handleSubmit = async () => {
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Store name is required.");
      return;
    }
    if (authKind === "desktop-app" && !accountName.trim()) {
      setError("Account name is required for desktop app auth.");
      return;
    }
    if (!vaultId.trim()) {
      setError("Vault ID is required.");
      return;
    }
    if (authKind === "service-account" && !tokenSecretId) {
      setError("Select a secret that contains the 1Password service account token.");
      return;
    }

    try {
      await props.onSubmit({
        name: trimmedName,
        config: {
          vaultId: vaultId.trim(),
          auth: onePasswordAuth()!,
        },
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Failed creating secret store.",
      );
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          {error}
        </Alert>
      )}

      <div className="grid gap-2">
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Team 1Password"
          autoFocus
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label>Auth method</Label>
          <Select
            value={authKind}
            onChange={(event) =>
              setAuthKind(event.target.value as "desktop-app" | "service-account")}
          >
            <option value="desktop-app">Desktop app</option>
            <option value="service-account">Service account</option>
          </Select>
        </div>
        <div className="flex items-end">
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              void handleDiscoverVaults();
            }}
            disabled={discoverVaultsMutation.status === "pending"}
          >
            {discoverVaultsMutation.status === "pending" ? "Loading..." : "Load vaults"}
          </Button>
        </div>
      </div>

      {authKind === "desktop-app" ? (
        <div className="grid gap-2">
          <Label>Account name or UUID</Label>
          <Input
            value={accountName}
            onChange={(event) => setAccountName(event.target.value)}
            placeholder="my.1password.com"
          />
          <div className="text-[11px] text-muted-foreground">
            Use the account shown in the 1Password desktop app sidebar or the
            account UUID from <code>op account list --format json</code>.
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label>Service Account Token Secret</Label>
          <Select
            value={tokenSecretId}
            onChange={(event) => setTokenSecretId(event.target.value)}
          >
            <option value="">
              {props.secrets.status === "ready"
                ? "Select a secret"
                : "Secrets are loading"}
            </option>
            {props.secrets.status === "ready" &&
              props.secrets.data.map((secret) => (
                <option key={secret.id} value={secret.id}>
                  {secret.name ?? secret.id}
                </option>
              ))}
          </Select>
          <div className="text-[11px] text-muted-foreground">
            Use this for remote or headless automation. Desktop app auth is better for
            local Executor use.
          </div>
        </div>
      )}

      {discoveredVaults.length > 0 && (
        <div className="grid gap-2">
          <Label>Discovered vaults</Label>
          <Select
            value={vaultId}
            onChange={(event) => setVaultId(event.target.value)}
          >
            {discoveredVaults.map((vault) => (
              <option key={vault.id} value={vault.id}>
                {vault.name}
              </option>
            ))}
          </Select>
          <div className="text-[11px] text-muted-foreground">
            Pick from the vaults visible to this account, or override the id below.
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <Label>Vault ID</Label>
        <Input
          value={vaultId}
          onChange={(event) => setVaultId(event.target.value)}
          placeholder="vlt_..."
          className="font-mono text-[12px]"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          type="button"
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={props.isSubmitting}
        >
          {props.isSubmitting ? "Creating..." : "Create store"}
        </Button>
      </div>
    </div>
  );
}
