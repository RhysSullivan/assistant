import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Id } from "@executor/database/convex/_generated/dataModel";

export type LinkedProvider = "anonymous" | "workos";

export interface LinkedMcpContext {
  readonly provider: LinkedProvider;
  readonly workspaceId: Id<"workspaces">;
  readonly accountId?: string;
  readonly sessionId?: string;
  readonly accessToken?: string;
  readonly mcpApiKey?: string;
  readonly clientId?: string;
  readonly linkedAt: number;
}

interface LinkStoreFile {
  readonly version: 1;
  readonly links: Record<string, LinkedMcpContext>;
}

export const defaultLinksFilePath = new URL("../../../.chat-links.json", import.meta.url).pathname;

function parseLinkedContext(value: unknown): LinkedMcpContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  const workspaceId = candidate.workspaceId;
  const linkedAt = candidate.linkedAt;

  if ((provider !== "anonymous" && provider !== "workos") || typeof workspaceId !== "string") {
    return null;
  }
  if (typeof linkedAt !== "number" || !Number.isFinite(linkedAt)) {
    return null;
  }

  return {
    provider,
    workspaceId: workspaceId as Id<"workspaces">,
    linkedAt,
    ...(typeof candidate.accountId === "string" ? { accountId: candidate.accountId } : {}),
    ...(typeof candidate.sessionId === "string" ? { sessionId: candidate.sessionId } : {}),
    ...(typeof candidate.accessToken === "string" ? { accessToken: candidate.accessToken } : {}),
    ...(typeof candidate.mcpApiKey === "string" ? { mcpApiKey: candidate.mcpApiKey } : {}),
    ...(typeof candidate.clientId === "string" ? { clientId: candidate.clientId } : {}),
  };
}

function parseLinksFile(value: unknown): Record<string, LinkedMcpContext> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) {
    return null;
  }
  if (!candidate.links || typeof candidate.links !== "object" || Array.isArray(candidate.links)) {
    return null;
  }

  const parsedLinks: Record<string, LinkedMcpContext> = {};
  for (const [identityKey, rawContext] of Object.entries(candidate.links)) {
    const parsedContext = parseLinkedContext(rawContext);
    if (!parsedContext) {
      continue;
    }
    parsedLinks[identityKey] = parsedContext;
  }

  return parsedLinks;
}

export function createFileLinkStore(filePath = Bun.env.ASSISTANT_LINKS_FILE ?? defaultLinksFilePath) {
  let loaded = false;
  let links: Record<string, LinkedMcpContext> = {};

  async function ensureLoaded() {
    if (loaded) return;
    loaded = true;

    const file = Bun.file(filePath);
    if (!(await file.exists())) return;

    const text = await file.text();
    if (!text.trim()) return;

    try {
      const parsedLinks = parseLinksFile(JSON.parse(text));
      if (parsedLinks) {
        links = parsedLinks;
      }
    } catch (error) {
      console.error(`[assistant] Failed to parse link store '${filePath}':`, error);
    }
  }

  async function persist() {
    await mkdir(dirname(filePath), { recursive: true });
    const payload = { version: 1, links } satisfies LinkStoreFile;
    await Bun.write(filePath, JSON.stringify(payload, null, 2));
  }

  return {
    filePath,

    async get(identityKey: string): Promise<LinkedMcpContext | undefined> {
      await ensureLoaded();
      return links[identityKey];
    },

    async set(identityKey: string, value: LinkedMcpContext): Promise<void> {
      await ensureLoaded();
      links[identityKey] = value;
      await persist();
    },

    async delete(identityKey: string): Promise<boolean> {
      await ensureLoaded();
      if (!links[identityKey]) return false;
      delete links[identityKey];
      await persist();
      return true;
    },
  };
}
