/**
 * /ask command handler
 *
 * Defers the interaction, creates a task on the server,
 * and mounts a self-updating <TaskMessage /> that subscribes
 * to the server's SSE stream via Eden Treaty.
 */

import type { ChatInputCommandInteraction, CommandInteraction } from "discord.js";
import type { Client as ApiClient } from "@openassistant/server/client";
import { unwrap } from "@openassistant/server/client";
import type { ReacordInstance } from "@openassistant/reacord";
import { Effect, Runtime } from "effect";
import { TaskMessage } from "../views/task-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AskCommandDeps {
  readonly api: ApiClient;
  readonly reacord: {
    reply: (interaction: CommandInteraction, content: React.ReactNode) => Effect.Effect<ReacordInstance>;
  };
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function handleAskCommand(
  interaction: ChatInputCommandInteraction,
  deps: AskCommandDeps,
): Promise<void> {
  const prompt = interaction.options.getString("prompt", true);
  const requesterId = interaction.user.id;

  // Defer immediately — Discord interactions expire after 3 seconds.
  await interaction.deferReply();

  // Create task on the server
  let taskId: string;
  let executionMode: "local" | "remote" = "local";
  try {
    const data = await unwrap(
      deps.api.api.tasks.post({ prompt, requesterId }),
    );
    taskId = data.taskId;
    executionMode = data.executionMode;
  } catch (error) {
    await interaction.editReply({
      content: `\u274c Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }

  // Mount the component — it handles its own SSE subscription and state
  await Runtime.runPromise(Runtime.defaultRuntime)(
    deps.reacord.reply(
      interaction,
      <TaskMessage taskId={taskId} prompt={prompt} api={deps.api} executionMode={executionMode} />,
    ),
  );
}
