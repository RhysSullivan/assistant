import type { InMemoryCalendarStore } from "./calendar-store.js";
import { createCalendarPlugin } from "./plugins/calendar-plugin.js";
import { createGitHubPlugin } from "./plugins/github/github-plugin.js";
import { composePlugins, type ToolingBundle } from "./plugins/plugin-system.js";

export function createToolingBundle(calendarStore: InMemoryCalendarStore): ToolingBundle {
  return composePlugins([
    createCalendarPlugin(calendarStore),
    createGitHubPlugin(),
  ]);
}
