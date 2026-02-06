import { defineTool, type ToolTree } from "@openassistant/core";
import { Effect } from "effect";
import type { InMemoryCalendarStore } from "../calendar-store.js";
import type { GatewayPlugin } from "./plugin-system.js";

export function createCalendarPlugin(calendarStore: InMemoryCalendarStore): GatewayPlugin {
  const tools: ToolTree = {
    calendar: {
      update: defineTool({
        kind: "write",
        approval: "required",
        run: (input: { title: string; startsAt: string; notes?: string }) =>
          Effect.sync(() => calendarStore.update(input)),
        previewInput: (input) => `${input.title} @ ${input.startsAt}`,
      }),
      list: defineTool({
        kind: "read",
        approval: "auto",
        run: () => Effect.sync(() => calendarStore.list()),
      }),
    },
  };

  return {
    name: "calendar",
    tools,
    promptGuidance: [
      "- tools.calendar.update({ title, startsAt, notes? }) creates or updates a calendar event (approval required).",
      "- tools.calendar.list() reads current events (auto-approved).",
    ].join("\n"),
    toolTypeDeclaration: [
      "calendar: {",
      "  update(input: { title: string; startsAt: string; notes?: string }): Promise<{ id: string; title: string; startsAt: string; notes?: string }>; ",
      "  list(): Promise<Array<{ id: string; title: string; startsAt: string; notes?: string }>>;",
      "};",
    ].join("\n"),
  };
}
