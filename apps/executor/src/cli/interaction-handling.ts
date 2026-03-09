import type { ParsedInteractionPayload } from "./pending-interaction-output";

export type InteractionHandling =
  | "url_interactive"
  | "url_paused"
  | "form_interactive"
  | "form_paused";

export const decideInteractionHandling = (input: {
  parsed: ParsedInteractionPayload | null;
  isInteractiveTerminal: boolean;
}): InteractionHandling => {
  if (input.parsed?.mode === "url") {
    return input.isInteractiveTerminal ? "url_interactive" : "url_paused";
  }

  return input.isInteractiveTerminal ? "form_interactive" : "form_paused";
};
