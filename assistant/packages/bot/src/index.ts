import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Message,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { createClient, unwrap } from "@assistant/server/client";

type ChatIdentity = {
  readonly platform: "discord";
  readonly userId: string;
};

const SERVER_URL = Bun.env.ASSISTANT_SERVER_URL ?? `http://localhost:${Bun.env.ASSISTANT_PORT ?? "3002"}`;
const DISCORD_TOKEN = Bun.env.DISCORD_TOKEN ?? Bun.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = Bun.env.DISCORD_GUILD_ID;
const COMMAND_PREFIX = Bun.env.ASSISTANT_COMMAND_PREFIX ?? "!";
const EXECUTOR_WEB_URL = Bun.env.EXECUTOR_WEB_URL
  ?? Bun.env.OPENASSISTANT_EXECUTOR_WEB_URL
  ?? Bun.env.OPENASSISTANT_EXECUTOR_URL
  ?? "http://localhost:3000";

if (!DISCORD_TOKEN) {
  throw new Error("DISCORD_TOKEN (or DISCORD_BOT_TOKEN) is required");
}
const BOT_TOKEN = DISCORD_TOKEN;

const api = createClient(SERVER_URL);
const subscribedChannels = new Set<string>();

const LINK_MODAL_ID = "assistant_link_workos_modal";
const LINK_OPEN_MODAL_BUTTON_ID = "assistant_link_workos_open_modal";
const LINK_FIELD_WORKSPACE = "workspace_id";
const LINK_FIELD_TOKEN = "access_token";
const LINK_FIELD_ACCOUNT = "account_id";

const slashCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the assistant in your linked context")
    .addStringOption((option) => option
      .setName("prompt")
      .setDescription("What you want the assistant to do")
      .setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("whoami")
    .setDescription("Show your current linked MCP context")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("link-workos")
    .setDescription("Link this Discord user to a WorkOS MCP context")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("link-anon")
    .setDescription("Link to an anonymous MCP session")
    .addStringOption((option) => option
      .setName("session_id")
      .setDescription("Optional session id to reuse"))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Remove your saved MCP link")
    .toJSON(),
];

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

function identityFromUser(userId: string): ChatIdentity {
  return {
    platform: "discord",
    userId,
  };
}

function truncate(value: string, max = 3500): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function chunkMessage(text: string, max = 1800): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    const splitAt = remaining.lastIndexOf("\n", max);
    const end = splitAt > max * 0.4 ? splitAt : max;
    chunks.push(remaining.slice(0, end));
    remaining = remaining.slice(end).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function reply(message: Message<boolean>, text: string) {
  const normalized = truncate(text, 12_000);
  const chunks = chunkMessage(normalized);
  for (const chunk of chunks) {
    await message.reply(chunk);
  }
}

function commandParts(text: string): readonly string[] {
  return text.trim().split(/\s+/).filter((part) => part.length > 0);
}

function stripBotMention(text: string, botUserId: string): string {
  return text
    .replaceAll(`<@${botUserId}>`, "")
    .replaceAll(`<@!${botUserId}>`, "")
    .trim();
}

function isCommand(text: string): boolean {
  return text.startsWith(COMMAND_PREFIX);
}

function parseCommand(text: string): { command: string; args: readonly string[] } {
  const withoutPrefix = text.slice(COMMAND_PREFIX.length).trim();
  const [command = "", ...args] = commandParts(withoutPrefix);
  return {
    command: command.toLowerCase(),
    args,
  };
}

async function getContext(identity: ChatIdentity) {
  const data = await unwrap(
    api.api.context.resolve.post({
      platform: identity.platform,
      userId: identity.userId,
    }),
  );
  return data.context;
}

async function linkWorkos(identity: ChatIdentity, workspaceId: string, accessToken: string, accountId?: string) {
  const data = await unwrap(
    api.api.context.link.post({
      platform: identity.platform,
      userId: identity.userId,
      provider: "workos",
      workspaceId,
      accessToken,
      accountId,
    }),
  );
  return data.context;
}

async function linkAnonymous(identity: ChatIdentity, sessionId?: string) {
  const data = await unwrap(
    api.api.context.link.post({
      platform: identity.platform,
      userId: identity.userId,
      provider: "anonymous",
      sessionId,
    }),
  );
  return data.context;
}

async function unlink(identity: ChatIdentity) {
  const data = await unwrap(
    api.api.context.unlink.post({
      platform: identity.platform,
      userId: identity.userId,
    }),
  );
  return data.removed;
}

async function runPrompt(identity: ChatIdentity, prompt: string) {
  const data = await unwrap(
    api.api.chat.run.post({
      platform: identity.platform,
      userId: identity.userId,
      prompt,
    }),
  );
  return data;
}

function contextLabel(context: {
  source: string;
  workspaceId: string;
  accountId?: string;
  sessionId?: string;
  hasAccessToken: boolean;
}) {
  return [
    `source=${context.source}`,
    `workspace=${context.workspaceId}`,
    context.accountId ? `account=${context.accountId}` : undefined,
    context.sessionId ? `session=${context.sessionId}` : undefined,
    context.hasAccessToken ? "auth=token" : "auth=session",
  ]
    .filter(Boolean)
    .join(" | ");
}

function createWorkosLinkModal() {
  const modal = new ModalBuilder()
    .setCustomId(LINK_MODAL_ID)
    .setTitle("Link WorkOS MCP Context");

  const workspaceInput = new TextInputBuilder()
    .setCustomId(LINK_FIELD_WORKSPACE)
    .setLabel("Workspace ID")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder("e.g. j57...workspace id");

  const tokenInput = new TextInputBuilder()
    .setCustomId(LINK_FIELD_TOKEN)
    .setLabel("Access Token")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder("Paste MCP bearer token");

  const accountInput = new TextInputBuilder()
    .setCustomId(LINK_FIELD_ACCOUNT)
    .setLabel("Account ID (optional)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder("Optional override");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(workspaceInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(tokenInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(accountInput),
  );

  return modal;
}

function buildExecutorLink(identity: ChatIdentity): string | null {
  try {
    const url = new URL(EXECUTOR_WEB_URL);
    url.searchParams.set("source", "discord-bot-link");
    url.searchParams.set("discord_user", identity.userId);
    return url.toString();
  } catch {
    return null;
  }
}

function buildLinkWorkosPanel(identity: ChatIdentity) {
  const executorLink = buildExecutorLink(identity);
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (executorLink) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("Open Executor")
        .setStyle(ButtonStyle.Link)
        .setURL(executorLink),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(LINK_OPEN_MODAL_BUTTON_ID)
      .setLabel("Paste Workspace + Token")
      .setStyle(ButtonStyle.Primary),
  );

  const instructions = [
    "Link your WorkOS account in 2 quick steps:",
    "1) Open Executor and sign in. Find your MCP workspace/token there.",
    "2) Click 'Paste Workspace + Token' and submit the private modal.",
    executorLink ? `Executor: ${executorLink}` : "Set EXECUTOR_WEB_URL to include a direct Executor link.",
  ].join("\n");

  return {
    content: instructions,
    components: [row],
  };
}

async function registerSlashCommands() {
  const appId = bot.user?.id;
  if (!appId) return;

  const rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

  if (DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(appId, DISCORD_GUILD_ID),
      { body: slashCommands },
    );
    console.log(`[assistant-bot] registered guild slash commands in ${DISCORD_GUILD_ID}`);
    return;
  }

  await rest.put(
    Routes.applicationCommands(appId),
    { body: slashCommands },
  );
  console.log("[assistant-bot] registered global slash commands");
}

async function handlePrefixCommand(message: Message<boolean>, rawText: string) {
  const { command, args } = parseCommand(rawText);
  const identity = identityFromUser(message.author.id);

  if (!command || command === "help") {
    await reply(message, [
      "Assistant commands:",
      "- /ask <prompt>",
      "- /whoami",
      "- /link-workos (opens secure modal)",
      "- /link-anon [session_id]",
      "- /unlink",
      `Prefix fallback: ${COMMAND_PREFIX}whoami, ${COMMAND_PREFIX}link-anon [sessionId], ${COMMAND_PREFIX}unlink`,
    ].join("\n"));
    return;
  }

  if (command === "whoami") {
    const context = await getContext(identity);
    await reply(message, `Current MCP context: ${contextLabel(context)}`);
    return;
  }

  if (command === "unlink") {
    const removed = await unlink(identity);
    await reply(message, removed ? "Link removed. You are back to anonymous context." : "No saved link found.");
    return;
  }

  if (command === "link-anon") {
    const [sessionId] = args;
    const context = await linkAnonymous(identity, sessionId);
    await reply(message, `Linked anonymous context: ${contextLabel(context)}`);
    return;
  }

  if (command === "link-workos") {
    const panel = buildLinkWorkosPanel(identity);
    await reply(message, `${panel.content}\nUse /link-workos to open the button panel in an ephemeral response.`);
    return;
  }

  await reply(message, `Unknown command '${command}'. Run /help or ${COMMAND_PREFIX}help.`);
}

bot.once("clientReady", async () => {
  console.log(`[assistant-bot] discord bot online as ${bot.user?.tag ?? "unknown"} (server: ${SERVER_URL})`);
  try {
    await registerSlashCommands();
  } catch (error) {
    console.error("[assistant-bot] failed to register slash commands", error);
  }
});

bot.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const identity = identityFromUser(interaction.user.id);

      if (interaction.commandName === "ask") {
        const prompt = interaction.options.getString("prompt", true);
        await interaction.deferReply();
        const result = await runPrompt(identity, prompt);
        const chunks = chunkMessage(result.text || "Done.");
        await interaction.editReply(chunks[0] ?? "Done.");
        for (let i = 1; i < chunks.length; i += 1) {
          await interaction.followUp(chunks[i]!);
        }
        return;
      }

      if (interaction.commandName === "whoami") {
        const context = await getContext(identity);
        await interaction.reply({
          content: `Current MCP context: ${contextLabel(context)}`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "unlink") {
        const removed = await unlink(identity);
        await interaction.reply({
          content: removed ? "Link removed. You are back to anonymous context." : "No saved link found.",
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "link-anon") {
        const sessionId = interaction.options.getString("session_id") ?? undefined;
        const context = await linkAnonymous(identity, sessionId);
        await interaction.reply({
          content: `Linked anonymous context: ${contextLabel(context)}`,
          ephemeral: true,
        });
        return;
      }

      if (interaction.commandName === "link-workos") {
        const panel = buildLinkWorkosPanel(identity);
        await interaction.reply({
          content: panel.content,
          components: panel.components,
          ephemeral: true,
        });
        return;
      }

      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === LINK_MODAL_ID) {
      const identity = identityFromUser(interaction.user.id);
      const workspaceId = interaction.fields.getTextInputValue(LINK_FIELD_WORKSPACE).trim();
      const accessToken = interaction.fields.getTextInputValue(LINK_FIELD_TOKEN).trim();
      const accountRaw = interaction.fields.getTextInputValue(LINK_FIELD_ACCOUNT).trim();
      const accountId = accountRaw.length > 0 ? accountRaw : undefined;

      if (!workspaceId || !accessToken) {
        await interaction.reply({
          content: "Workspace ID and access token are required.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const context = await linkWorkos(identity, workspaceId, accessToken, accountId);
      await interaction.editReply(`Linked WorkOS context: ${contextLabel(context)}`);
      return;
    }

    if (interaction.isButton() && interaction.customId === LINK_OPEN_MODAL_BUTTON_ID) {
      await interaction.showModal(createWorkosLinkModal());
      return;
    }
  } catch (error) {
    const text = `Warning: ${truncate(error instanceof Error ? error.message : String(error), 1200)}`;

    if (interaction.isRepliable()) {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: text, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: text, ephemeral: true }).catch(() => {});
      }
    }
  }
});

bot.on("messageCreate", async (message) => {
  if (!message.inGuild() && message.channel.type !== ChannelType.DM) return;
  if (message.author.bot) return;

  const botUserId = bot.user?.id;
  if (!botUserId) return;

  const rawText = message.content?.trim() ?? "";
  if (!rawText && !message.mentions.users.has(botUserId)) return;

  const mentioned = message.mentions.users.has(botUserId);
  const subscribed = subscribedChannels.has(message.channelId);
  const command = isCommand(rawText);

  if (!mentioned && !subscribed && !command && message.channel.type !== ChannelType.DM) {
    return;
  }

  try {
    if (command) {
      await handlePrefixCommand(message, rawText);
      return;
    }

    let prompt = rawText;
    if (mentioned) {
      subscribedChannels.add(message.channelId);
      prompt = stripBotMention(rawText, botUserId);
      if (!prompt) {
        await reply(message, "I am listening. Send a prompt here, or use `/ask`.");
        return;
      }
    }

    await message.channel.sendTyping();
    const result = await runPrompt(identityFromUser(message.author.id), prompt);
    await reply(message, result.text || "Done.");
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await reply(message, `Warning: ${truncate(messageText, 1400)}`);
  }
});

await bot.login(BOT_TOKEN);
