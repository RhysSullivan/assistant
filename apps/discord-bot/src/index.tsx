import { createCodeModeRunner } from "@openassistant/core";
import { makeReacord } from "@openassistant/reacord";
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  Partials,
  type SendableChannels,
} from "discord.js";
import { Effect } from "effect";
import { DiscordApprovalBridge } from "./approval-bridge.js";
import { runAgentLoop } from "./agent-loop.js";
import { InMemoryCalendarStore } from "./calendar-store.js";
import { AssistantReplyView, AssistantWorkingView } from "./discord-views.js";
import { formatDiscordResponse } from "./format-response.js";
import { createToolTree } from "./tools.js";

const token = Bun.env.DISCORD_BOT_TOKEN;
if (!token) {
  throw new Error("Missing DISCORD_BOT_TOKEN");
}

const approvalTimeoutMs = Number(Bun.env.OPENASSISTANT_APPROVAL_TIMEOUT_MS ?? 300_000);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const approvalBridge = new DiscordApprovalBridge(client, approvalTimeoutMs);
const reacord = makeReacord(client);
const calendarStore = new InMemoryCalendarStore();
const tools = createToolTree(calendarStore);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`[discord-bot] logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (shouldIgnore(message)) {
    return;
  }
  await handleMessage(message);
});

await client.login(token);

function shouldIgnore(message: Message): boolean {
  return message.author.bot || message.content.trim().length === 0 || message.channel.type !== ChannelType.DM;
}

async function handleMessage(message: Message): Promise<void> {
  const approvalChannel = asSendableChannel(message.channel);
  if (!approvalChannel) {
    await message.reply("This channel does not support assistant responses.");
    return;
  }

  const instance = await Effect.runPromise(
    reacord.send(approvalChannel, <AssistantWorkingView />, {
      reply: { messageReference: message.id },
    }),
  );

  try {
    const runner = createCodeModeRunner({
      tools,
      requestApproval: (request) =>
        Effect.tryPromise({
          try: () =>
            approvalBridge.requestApproval({
              request,
              channel: approvalChannel,
              requesterId: message.author.id,
            }),
          catch: (error) => error,
        }),
    });

    const generated = await runAgentLoop(message.content, (code) =>
      Effect.runPromise(runner.run({ code })),
    );
    const response = formatDiscordResponse({
      prompt: message.content,
      text: generated.text,
      planner: generated.planner,
      provider: generated.provider,
      runs: generated.runs,
    });

    instance.render(<AssistantReplyView message={response.message} footer={response.footer} />);
  } catch (error) {
    instance.render(
      <AssistantReplyView
        message={`I hit an unexpected error while processing that request: ${describeUnknown(error)}`}
      />,
    );
  }
}

function asSendableChannel(channel: unknown): SendableChannels | null {
  if (!channel || typeof channel !== "object") {
    return null;
  }
  if (!("send" in channel) || typeof (channel as { send?: unknown }).send !== "function") {
    return null;
  }
  return channel as SendableChannels;
}

function describeUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
