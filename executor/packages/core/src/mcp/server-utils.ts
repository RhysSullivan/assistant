export function getTaskTerminalState(status: string): boolean {
  return status === "completed" || status === "failed" || status === "timed_out" || status === "denied";
}

export function textContent(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}
