import { useEffect, useMemo, useReducer } from "react";
import type {
  CredentialRecord,
  CredentialScope,
  SourceAuthProfile,
  ToolSourceRecord,
} from "@/lib/types";
import {
  formatHeaderOverrides,
  sourceAuthForKey,
} from "@/lib/credentials-source-helpers";
import {
  buildConnectionOptions,
  buildSourceOptions,
  compatibleConnections,
  selectedAuthBadge,
  type ConnectionMode,
} from "./connection-form-dialog-state";

type UseConnectionFormDialogFormParams = {
  open: boolean;
  editing: CredentialRecord | null;
  initialSourceKey?: string | null;
  sources: ToolSourceRecord[];
  credentials: CredentialRecord[];
  sourceAuthProfiles: Record<string, SourceAuthProfile>;
  actorIdFallback?: string;
};

type FormState = {
  sourceKey: string;
  scope: CredentialScope;
  actorId: string;
  connectionMode: ConnectionMode;
  existingConnectionId: string;
  tokenValue: string;
  apiKeyValue: string;
  basicUsername: string;
  basicPassword: string;
  customHeadersText: string;
};

type FormAction =
  | { type: "patch"; patch: Partial<FormState> }
  | { type: "reset"; next: FormState };

function formReducer(state: FormState, action: FormAction): FormState {
  if (action.type === "reset") {
    return action.next;
  }
  return { ...state, ...action.patch };
}

function initialFormState({
  editing,
  initialSourceKey,
  sourceOptions,
  sourceAuthProfiles,
  actorIdFallback,
}: {
  editing: CredentialRecord | null;
  initialSourceKey?: string | null;
  sourceOptions: ReturnType<typeof buildSourceOptions>;
  sourceAuthProfiles: Record<string, SourceAuthProfile>;
  actorIdFallback?: string;
}): FormState {
  if (editing) {
    return {
      sourceKey: editing.sourceKey,
      scope: editing.scope,
      actorId: editing.actorId ?? actorIdFallback ?? "",
      connectionMode: "new",
      existingConnectionId: editing.id,
      tokenValue: "",
      apiKeyValue: "",
      basicUsername: "",
      basicPassword: "",
      customHeadersText: formatHeaderOverrides(editing.overridesJson),
    };
  }

  const resolvedSourceKey = initialSourceKey ?? sourceOptions[0]?.key ?? "";
  const auth = sourceAuthForKey(sourceOptions, resolvedSourceKey, sourceAuthProfiles);
  return {
    sourceKey: resolvedSourceKey,
    scope: auth.mode ?? "workspace",
    actorId: actorIdFallback ?? "",
    connectionMode: "new",
    existingConnectionId: "",
    tokenValue: "",
    apiKeyValue: "",
    basicUsername: "",
    basicPassword: "",
    customHeadersText: "",
  };
}

export function useConnectionFormDialogForm({
  open,
  editing,
  initialSourceKey,
  sources,
  credentials,
  sourceAuthProfiles,
  actorIdFallback,
}: UseConnectionFormDialogFormParams) {
  const sourceOptions = useMemo(() => buildSourceOptions(sources), [sources]);
  const connectionOptions = useMemo(() => buildConnectionOptions(credentials), [credentials]);
  const [form, dispatch] = useReducer(
    formReducer,
    initialFormState({
      editing,
      initialSourceKey,
      sourceOptions,
      sourceAuthProfiles,
      actorIdFallback,
    }),
  );

  const {
    sourceKey,
    scope,
    actorId,
    connectionMode,
    existingConnectionId: rawExistingConnectionId,
    tokenValue,
    apiKeyValue,
    basicUsername,
    basicPassword,
    customHeadersText,
  } = form;
  const compatibleConnectionOptions = useMemo(
    () => compatibleConnections(connectionOptions, scope, actorId),
    [actorId, connectionOptions, scope],
  );
  const existingConnectionId = useMemo(() => {
    if (!rawExistingConnectionId) {
      return "";
    }

    return compatibleConnectionOptions.some((connection) => connection.id === rawExistingConnectionId)
      ? rawExistingConnectionId
      : "";
  }, [compatibleConnectionOptions, rawExistingConnectionId]);
  const selectedAuth = useMemo(
    () => sourceAuthForKey(sourceOptions, sourceKey, sourceAuthProfiles),
    [sourceAuthProfiles, sourceKey, sourceOptions],
  );
  const authBadge = useMemo(
    () => selectedAuthBadge(selectedAuth.type, selectedAuth.mode),
    [selectedAuth.mode, selectedAuth.type],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (editing) {
      dispatch({
        type: "reset",
        next: initialFormState({
          editing,
          initialSourceKey,
          sourceOptions,
          sourceAuthProfiles,
          actorIdFallback,
        }),
      });
      return;
    }

    dispatch({
      type: "reset",
      next: initialFormState({
        editing: null,
        initialSourceKey,
        sourceOptions,
        sourceAuthProfiles,
        actorIdFallback,
      }),
    });
  }, [actorIdFallback, editing, initialSourceKey, open, sourceAuthProfiles, sourceOptions]);

  const handleSourceKeyChange = (nextSourceKey: string) => {
    const patch: Partial<FormState> = { sourceKey: nextSourceKey };
    const auth = sourceAuthForKey(sourceOptions, nextSourceKey, sourceAuthProfiles);
    if (!editing) {
      patch.scope = auth.mode ?? "workspace";
    }
    dispatch({ type: "patch", patch });
  };

  const setScope = (nextScope: CredentialScope) => {
    dispatch({ type: "patch", patch: { scope: nextScope } });
  };

  const setActorId = (nextActorId: string) => {
    dispatch({ type: "patch", patch: { actorId: nextActorId } });
  };

  const setConnectionMode = (nextMode: ConnectionMode) => {
    dispatch({ type: "patch", patch: { connectionMode: nextMode } });
  };

  const setExistingConnectionId = (nextConnectionId: string) => {
    dispatch({ type: "patch", patch: { existingConnectionId: nextConnectionId } });
  };

  const setTokenValue = (nextToken: string) => {
    dispatch({ type: "patch", patch: { tokenValue: nextToken } });
  };

  const setApiKeyValue = (nextApiKeyValue: string) => {
    dispatch({ type: "patch", patch: { apiKeyValue: nextApiKeyValue } });
  };

  const setBasicUsername = (nextBasicUsername: string) => {
    dispatch({ type: "patch", patch: { basicUsername: nextBasicUsername } });
  };

  const setBasicPassword = (nextBasicPassword: string) => {
    dispatch({ type: "patch", patch: { basicPassword: nextBasicPassword } });
  };

  const setCustomHeadersText = (nextCustomHeadersText: string) => {
    dispatch({ type: "patch", patch: { customHeadersText: nextCustomHeadersText } });
  };

  return {
    sourceKey,
    scope,
    actorId,
    connectionMode,
    existingConnectionId,
    tokenValue,
    apiKeyValue,
    basicUsername,
    basicPassword,
    customHeadersText,
    sourceOptions,
    connectionOptions,
    compatibleConnectionOptions,
    selectedAuth,
    authBadge,
    setScope,
    setActorId,
    setConnectionMode,
    setExistingConnectionId,
    setTokenValue,
    setApiKeyValue,
    setBasicUsername,
    setBasicPassword,
    setCustomHeadersText,
    handleSourceKeyChange,
  };
}
