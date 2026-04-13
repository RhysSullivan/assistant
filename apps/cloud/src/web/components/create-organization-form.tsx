import { useReducer } from "react";
import { useAtomSet } from "@effect-atom/atom-react";
import { Input } from "@executor/react/components/input";
import { Label } from "@executor/react/components/label";

import { createOrganization } from "../auth";

type CreatedOrganization = { id: string; name: string };

type State = {
  name: string;
  error: string | null;
  creating: boolean;
};

type Action =
  | { type: "setName"; name: string }
  | { type: "submitStart" }
  | { type: "submitEnd"; error: string | null }
  | { type: "reset"; name: string };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    // Typing into the field clears any stale error. Consolidating this into
    // the reducer means callers don't need to wire up an explicit clear.
    case "setName":
      return { ...state, name: action.name, error: null };
    case "submitStart":
      return { ...state, creating: true, error: null };
    case "submitEnd":
      return { ...state, creating: false, error: action.error };
    case "reset":
      return { name: action.name, error: null, creating: false };
  }
};

export function useCreateOrganizationForm(options: {
  defaultName?: string;
  onSuccess: (org: CreatedOrganization) => void;
  onFailure?: () => void;
}) {
  const doCreate = useAtomSet(createOrganization, { mode: "promiseExit" });
  const [state, dispatch] = useReducer(reducer, {
    name: options.defaultName ?? "",
    error: null,
    creating: false,
  });

  const setName = (name: string) => dispatch({ type: "setName", name });

  const reset = (nextName = options.defaultName ?? "") =>
    dispatch({ type: "reset", name: nextName });

  const submit = async () => {
    const trimmed = state.name.trim();
    if (!trimmed) {
      dispatch({ type: "submitEnd", error: "Organization name is required." });
      return;
    }
    dispatch({ type: "submitStart" });
    const exit = await doCreate({ payload: { name: trimmed } });
    if (exit._tag === "Success") {
      dispatch({ type: "submitEnd", error: null });
      options.onSuccess(exit.value);
    } else {
      dispatch({ type: "submitEnd", error: "Failed to create organization." });
      options.onFailure?.();
    }
  };

  return {
    name: state.name,
    setName,
    error: state.error,
    creating: state.creating,
    submit,
    reset,
    canSubmit: state.name.trim().length > 0,
  };
}

export function CreateOrganizationFields(props: {
  name: string;
  onNameChange: (name: string) => void;
  error: string | null;
  onSubmit: () => void;
}) {
  return (
    <div className="grid gap-4 py-3">
      <div className="grid gap-1.5">
        <Label
          htmlFor="organization-name"
          className="text-sm font-medium uppercase tracking-wider text-muted-foreground"
        >
          Organization name
        </Label>
        <Input
          id="organization-name"
          value={props.name}
          placeholder="Northwind Labs"
          autoFocus
          onChange={(event) => props.onNameChange((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") props.onSubmit();
          }}
          className="h-9 text-sm"
        />
      </div>

      {props.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive">{props.error}</p>
        </div>
      )}
    </div>
  );
}
