# Assistant Monorepo

Assistant-side code lives here.

## Packages

- `packages/core`: agent loop that talks to executor over MCP and calls `run_code`.
- `packages/server`: chat-facing API that resolves user identity to MCP context and runs prompts.
- `packages/bot`: Discord bot with account-link commands.

## Chat-first flow

1. User mentions the bot in Discord.
2. Bot subscribes to the thread and sends prompts to `@assistant/server`.
3. Server resolves MCP context per chat user:
   - default: deterministic anonymous `sessionId` via executor bootstrap;
   - linked: saved anonymous session or WorkOS bearer token.
4. `@assistant/core` runs the prompt via MCP `run_code` and returns text.
5. Bot posts the response back to the thread.

## Link commands (Discord)

Preferred slash commands:

- `/whoami`
- `/link-workos` (opens a private modal for workspace/token)
- `/link-anon [session_id]`
- `/unlink`

Prompt commands:

- `/ask <prompt>`
- mention-based thread mode (mention bot once, then keep chatting)

Prefix fallback (optional):

- `!whoami`
- `!link-anon [sessionId]`
- `!unlink`

Links persist in `assistant/.chat-links.json` by default. Override with `ASSISTANT_LINKS_FILE`.

Bot env requirements: `DISCORD_TOKEN` (optional prefix override via `ASSISTANT_COMMAND_PREFIX`).

For better linking UX, set `EXECUTOR_WEB_URL` so `/link-workos` can send a one-click "Open Executor" button.
