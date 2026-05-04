import { useMemo, useState, Suspense } from "react";
import { useAtomValue, useAtomSet } from "@effect/atom-react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { secretsAtom, removeSecret } from "../api/atoms";
import { secretWriteKeys } from "../api/reactivity-keys";
import { useSecretProviderPlugins } from "@executor-js/sdk/client";
import { SecretId } from "@executor-js/sdk";
import { SecretForm } from "../plugins/secret-form";
import { useScope } from "../hooks/use-scope";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "../components/dialog";
import { Button } from "../components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/dropdown-menu";
import {
  CardStack,
  CardStackContent,
  CardStackEntry,
  CardStackEntryActions,
  CardStackEntryContent,
  CardStackEntryDescription,
  CardStackEntryTitle,
  CardStackHeader,
} from "../components/card-stack";
import { Badge } from "../components/badge";

type SecretStorageOption = {
  readonly label: string;
  readonly value: string;
};

const defaultStorageOptions: readonly SecretStorageOption[] = [
  { value: "auto", label: "Auto" },
  { value: "keychain", label: "Keychain" },
  { value: "file", label: "File" },
];

// ---------------------------------------------------------------------------
// Add secret dialog
//
// Form state, derived id, dup detection, and submit lifecycle live in
// `<SecretForm.Provider>` and are shared with the inline create flow in
// secret-header-auth.tsx. Dialog content remounts on each open via `key` so
// state always starts fresh — no manual reset.
// ---------------------------------------------------------------------------

function AddSecretDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  description: string;
  storageOptions: readonly SecretStorageOption[];
  existingSecretIds: readonly string[];
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && (
        <AddSecretDialogContent
          key="open"
          description={props.description}
          storageOptions={props.storageOptions}
          existingSecretIds={props.existingSecretIds}
          onClose={() => props.onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function AddSecretDialogContent(props: {
  description: string;
  storageOptions: readonly SecretStorageOption[];
  existingSecretIds: readonly string[];
  onClose: () => void;
}) {
  const initialProvider = props.storageOptions[0]?.value ?? "auto";

  return (
    <SecretForm.Provider
      existingSecretIds={props.existingSecretIds}
      initialProvider={initialProvider}
      onCreated={props.onClose}
    >
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">New secret</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {props.description}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-3">
          <div className="grid grid-cols-2 gap-3">
            <SecretForm.NameField />
            <SecretForm.IdField />
          </div>
          <SecretForm.ValueField />
          <SecretForm.ProviderField options={props.storageOptions} />
          <SecretForm.ErrorBanner />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <SecretForm.SubmitButton size="sm">Save secret</SecretForm.SubmitButton>
        </DialogFooter>
      </DialogContent>
    </SecretForm.Provider>
  );
}

// ---------------------------------------------------------------------------
// Secret row
// ---------------------------------------------------------------------------

function SecretRow(props: {
  showProvider: boolean;
  secret: { id: string; name: string; provider?: string };
  onRemove: () => void;
}) {
  const { secret, showProvider } = props;

  return (
    <CardStackEntry>
      <CardStackEntryContent>
        <CardStackEntryTitle className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 shrink truncate" title={secret.name}>
            {secret.name}
          </span>
          <span
            className="max-w-40 shrink truncate font-mono text-xs text-muted-foreground"
            title={secret.id}
          >
            {secret.id}
          </span>
        </CardStackEntryTitle>
      </CardStackEntryContent>
      <CardStackEntryActions>
        {showProvider && secret.provider && <Badge variant="outline">{secret.provider}</Badge>}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 transition-opacity group-hover/card-stack-entry:opacity-100 group-focus-within/card-stack-entry:opacity-100 data-[state=open]:opacity-100"
            >
              <svg viewBox="0 0 16 16" className="size-3">
                <circle cx="8" cy="3" r="1.2" fill="currentColor" />
                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                <circle cx="8" cy="13" r="1.2" fill="currentColor" />
              </svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive text-sm"
              onClick={props.onRemove}
            >
              Remove secret
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardStackEntryActions>
    </CardStackEntry>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SecretsPage(props: {
  addSecretDescription?: string;
  showProviderInfo?: boolean;
  storageOptions?: readonly SecretStorageOption[];
}) {
  const storageOptions = props.storageOptions ?? defaultStorageOptions;
  const showProviderInfo = props.showProviderInfo ?? true;
  const addSecretDescription =
    props.addSecretDescription ??
    "Store a credential or API key. Values are kept in your system keychain when available, with a local encrypted file fallback.";
  const secretProviderPlugins = useSecretProviderPlugins();
  const [addOpen, setAddOpen] = useState(false);
  const scopeId = useScope();
  const secrets = useAtomValue(secretsAtom(scopeId));
  const existingSecretIds = useMemo(
    () =>
      AsyncResult.match(secrets, {
        onInitial: () => [] as string[],
        onFailure: () => [] as string[],
        onSuccess: ({ value }) => value.map((secret) => secret.id),
      }),
    [secrets],
  );
  const doRemove = useAtomSet(removeSecret, { mode: "promise" });

  const handleRemove = async (secretId: string) => {
    try {
      await doRemove({
        params: {
          scopeId,
          secretId: SecretId.make(secretId),
        },
        reactivityKeys: secretWriteKeys,
      });
    } catch {
      // TODO: toast
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10 lg:px-8 lg:py-14">
        {/* Header */}
        <div className="flex items-end justify-between mb-10">
          <div>
            <h1 className="font-display text-[2rem] tracking-tight text-foreground leading-none">
              Secrets
            </h1>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
              Credentials and API keys used by your connected sources.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            Add secret
          </Button>
        </div>

        {/* Provider plugins */}
        {showProviderInfo && secretProviderPlugins.length > 0 && (
          <div className="mb-10">
            <CardStack>
              <CardStackHeader>Providers</CardStackHeader>
              <CardStackContent>
                {secretProviderPlugins.map((plugin) => (
                  <Suspense
                    key={plugin.key}
                    fallback={
                      <div className="px-4 py-3 animate-pulse">
                        <div className="h-4 w-24 rounded bg-muted" />
                      </div>
                    }
                  >
                    <plugin.settings />
                  </Suspense>
                ))}
              </CardStackContent>
            </CardStack>
          </div>
        )}

        {/* Secrets list */}
        {AsyncResult.match(secrets, {
          onInitial: () => (
            <div className="flex items-center gap-2 py-8">
              <div className="size-1.5 rounded-full bg-muted-foreground/30 animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading secrets…</p>
            </div>
          ),
          onFailure: () => (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-destructive">Failed to load secrets</p>
            </div>
          ),
          onSuccess: ({ value }) => (
            <CardStack>
              <CardStackHeader>Secrets</CardStackHeader>
              <CardStackContent>
                {value.length === 0 ? (
                  <CardStackEntry>
                    <CardStackEntryContent>
                      <CardStackEntryDescription>
                        Add API keys and credentials to authenticate your sources.
                      </CardStackEntryDescription>
                    </CardStackEntryContent>
                    <CardStackEntryActions>
                      <Button
                        variant="link"
                        size="sm"
                        className="h-7 px-0 text-xs"
                        onClick={() => setAddOpen(true)}
                      >
                        Add your first secret
                      </Button>
                    </CardStackEntryActions>
                  </CardStackEntry>
                ) : (
                  value.map(
                    (s: {
                      readonly id: string;
                      readonly name: string;
                      readonly provider: string;
                    }) => (
                      <SecretRow
                        key={s.id}
                        showProvider={showProviderInfo}
                        secret={{
                          id: s.id,
                          name: s.name,
                          provider: s.provider ? String(s.provider) : undefined,
                        }}
                        onRemove={() => handleRemove(s.id)}
                      />
                    ),
                  )
                )}
              </CardStackContent>
            </CardStack>
          ),
        })}

        <AddSecretDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          description={addSecretDescription}
          storageOptions={storageOptions}
          existingSecretIds={existingSecretIds}
        />
      </div>
    </div>
  );
}
