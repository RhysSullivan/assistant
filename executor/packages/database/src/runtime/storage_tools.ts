import type { ActionCtx } from "../../convex/_generated/server";
import { internal } from "../../convex/_generated/api";
import type { TaskRecord, StorageInstanceRecord } from "../../../core/src/types";
import { getStorageProvider, type StorageEncoding, type StorageProvider } from "./storage_provider";
import {
  fsMkdirInputSchema,
  fsMkdirOutputSchema,
  fsReadInputSchema,
  fsReadOutputSchema,
  fsReaddirInputSchema,
  fsReaddirOutputSchema,
  fsRemoveInputSchema,
  fsRemoveOutputSchema,
  fsStatInputSchema,
  fsStatOutputSchema,
  fsWriteInputSchema,
  fsWriteOutputSchema,
  kvDeleteInputSchema,
  kvDeleteOutputSchema,
  kvGetInputSchema,
  kvGetOutputSchema,
  kvListInputSchema,
  kvListOutputSchema,
  kvSetInputSchema,
  kvSetOutputSchema,
  sqliteQueryInputSchema,
  sqliteQueryOutputSchema,
  storageCloseInputSchema,
  storageCloseOutputSchema,
  storageDeleteInputSchema,
  storageDeleteOutputSchema,
  storageListInputSchema,
  storageListOutputSchema,
  storageOpenInputSchema,
  storageOpenOutputSchema,
} from "./storage_tool_contracts";

const STORAGE_SYSTEM_TOOLS = new Set([
  "storage.open",
  "storage.list",
  "storage.close",
  "storage.delete",
  "fs.read",
  "fs.write",
  "fs.readdir",
  "fs.stat",
  "fs.mkdir",
  "fs.remove",
  "kv.get",
  "kv.set",
  "kv.list",
  "kv.delete",
  "sqlite.query",
]);

function toInputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return input as Record<string, unknown>;
}

function normalizeScopeType(value: unknown): undefined | "scratch" | "account" | "workspace" | "organization" {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "scratch" || normalized === "account" || normalized === "workspace" || normalized === "organization") {
    return normalized;
  }
  return undefined;
}

function normalizeInstanceId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeInputPayload(input: unknown): Record<string, unknown> {
  const payload = toInputRecord(input);
  return {
    ...payload,
    ...(normalizeScopeType(payload.scopeType) ? { scopeType: normalizeScopeType(payload.scopeType) } : {}),
    ...(normalizeInstanceId(payload.instanceId) ? { instanceId: normalizeInstanceId(payload.instanceId) } : {}),
  };
}

async function openStorageInstanceForTask(
  ctx: ActionCtx,
  task: TaskRecord,
  args: {
    instanceId?: string;
    scopeType?: "scratch" | "account" | "workspace" | "organization";
    durability?: "ephemeral" | "durable";
    purpose?: string;
    ttlHours?: number;
  },
): Promise<StorageInstanceRecord> {
  const opened = await ctx.runMutation(internal.database.openStorageInstance, {
    workspaceId: task.workspaceId,
    accountId: task.accountId,
    instanceId: args.instanceId,
    scopeType: args.scopeType,
    durability: args.durability,
    purpose: args.purpose,
    ttlHours: args.ttlHours,
  });
  return opened as StorageInstanceRecord;
}

async function resolveStorageInstance(
  ctx: ActionCtx,
  task: TaskRecord,
  payload: Record<string, unknown>,
): Promise<StorageInstanceRecord> {
  const requestedInstanceId = normalizeInstanceId(payload.instanceId);
  const scopeType = normalizeScopeType(payload.scopeType);

  if (requestedInstanceId) {
    const existing = await ctx.runQuery(internal.database.getStorageInstance, {
      workspaceId: task.workspaceId,
      accountId: task.accountId,
      instanceId: requestedInstanceId,
    });
    if (!existing) {
      throw new Error(`Storage instance not found: ${requestedInstanceId}`);
    }

    const reopened = await openStorageInstanceForTask(ctx, task, {
      instanceId: requestedInstanceId,
    });
    return reopened;
  }

  return await openStorageInstanceForTask(ctx, task, {
    scopeType,
    purpose: "auto",
  });
}

async function touchInstance(
  ctx: ActionCtx,
  task: TaskRecord,
  instance: StorageInstanceRecord,
  provider: StorageProvider,
  withUsage: boolean,
) {
  const usage = withUsage ? await provider.usage(instance) : undefined;
  await ctx.runMutation(internal.database.touchStorageInstance, {
    workspaceId: task.workspaceId,
    accountId: task.accountId,
    instanceId: instance.id,
    provider: instance.provider,
    ...(usage?.sizeBytes !== undefined ? { sizeBytes: usage.sizeBytes } : {}),
    ...(usage?.fileCount !== undefined ? { fileCount: usage.fileCount } : {}),
  });
}

export function isStorageSystemToolPath(path: string): boolean {
  return STORAGE_SYSTEM_TOOLS.has(path);
}

export async function runStorageSystemTool(
  ctx: ActionCtx,
  task: TaskRecord,
  toolPath: string,
  input: unknown,
): Promise<unknown> {
  const payload = normalizeInputPayload(input);

  if (toolPath === "storage.open") {
    const parsed = storageOpenInputSchema.parse(payload);
    const instance = await openStorageInstanceForTask(ctx, task, parsed);
    return storageOpenOutputSchema.parse({ instance });
  }

  if (toolPath === "storage.list") {
    const parsed = storageListInputSchema.parse(payload);
    const instances = await ctx.runQuery(internal.database.listStorageInstances, {
      workspaceId: task.workspaceId,
      accountId: task.accountId,
      scopeType: parsed.scopeType,
      includeDeleted: parsed.includeDeleted,
    });

    return storageListOutputSchema.parse({
      instances,
      total: instances.length,
    });
  }

  if (toolPath === "storage.close") {
    const parsed = storageCloseInputSchema.parse(payload);
    const instance = await ctx.runMutation(internal.database.closeStorageInstance, {
      workspaceId: task.workspaceId,
      accountId: task.accountId,
      instanceId: parsed.instanceId,
    });
    return storageCloseOutputSchema.parse({ instance });
  }

  if (toolPath === "storage.delete") {
    const parsed = storageDeleteInputSchema.parse(payload);
    const existing = await ctx.runQuery(internal.database.getStorageInstance, {
      workspaceId: task.workspaceId,
      accountId: task.accountId,
      instanceId: parsed.instanceId,
    }) as StorageInstanceRecord | null;

    if (existing) {
      const provider = getStorageProvider(existing.provider);
      try {
        await provider.deleteInstance(existing);
      } catch {
        // Continue marking the instance deleted even if backend cleanup fails.
      }
    }

    const instance = await ctx.runMutation(internal.database.deleteStorageInstance, {
      workspaceId: task.workspaceId,
      accountId: task.accountId,
      instanceId: parsed.instanceId,
    });
    return storageDeleteOutputSchema.parse({ instance });
  }

  if (toolPath === "fs.read") {
    const parsed = fsReadInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    const encoding = parsed.encoding ?? "utf8";
    const file = await provider.readFile(instance, parsed.path, encoding as StorageEncoding);
    await touchInstance(ctx, task, instance, provider, false);
    return fsReadOutputSchema.parse({
      instanceId: instance.id,
      path: parsed.path,
      encoding,
      content: file.content,
      bytes: file.bytes,
    });
  }

  if (toolPath === "fs.write") {
    const parsed = fsWriteInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    const encoding = parsed.encoding ?? "utf8";
    const result = await provider.writeFile(instance, parsed.path, parsed.content, encoding as StorageEncoding);
    await touchInstance(ctx, task, instance, provider, true);
    return fsWriteOutputSchema.parse({
      instanceId: instance.id,
      path: parsed.path,
      bytesWritten: result.bytesWritten,
    });
  }

  if (toolPath === "fs.readdir") {
    const parsed = fsReaddirInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    const path = parsed.path ?? "/";
    const entries = await provider.readdir(instance, path);
    await touchInstance(ctx, task, instance, provider, false);
    return fsReaddirOutputSchema.parse({
      instanceId: instance.id,
      path,
      entries,
    });
  }

  if (toolPath === "fs.stat") {
    const parsed = fsStatInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    const stat = await provider.stat(instance, parsed.path);
    await touchInstance(ctx, task, instance, provider, false);
    return fsStatOutputSchema.parse({
      instanceId: instance.id,
      path: parsed.path,
      ...stat,
    });
  }

  if (toolPath === "fs.mkdir") {
    const parsed = fsMkdirInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    await provider.mkdir(instance, parsed.path);
    await touchInstance(ctx, task, instance, provider, true);
    return fsMkdirOutputSchema.parse({
      instanceId: instance.id,
      path: parsed.path,
      ok: true,
    });
  }

  if (toolPath === "fs.remove") {
    const parsed = fsRemoveInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    await provider.remove(instance, parsed.path, {
      recursive: parsed.recursive,
      force: parsed.force,
    });
    await touchInstance(ctx, task, instance, provider, true);
    return fsRemoveOutputSchema.parse({
      instanceId: instance.id,
      path: parsed.path,
      ok: true,
    });
  }

  if (toolPath === "kv.get") {
    const parsed = kvGetInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    const value = await provider.kvGet(instance, parsed.key);
    await touchInstance(ctx, task, instance, provider, false);
    return kvGetOutputSchema.parse({
      instanceId: instance.id,
      key: parsed.key,
      found: value !== undefined,
      ...(value !== undefined ? { value } : {}),
    });
  }

  if (toolPath === "kv.set") {
    const parsed = kvSetInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    await provider.kvSet(instance, parsed.key, parsed.value);
    await touchInstance(ctx, task, instance, provider, true);
    return kvSetOutputSchema.parse({
      instanceId: instance.id,
      key: parsed.key,
      ok: true,
    });
  }

  if (toolPath === "kv.list") {
    const parsed = kvListInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    const limit = Math.max(1, Math.min(500, Math.floor(parsed.limit ?? 100)));
    const items = await provider.kvList(instance, parsed.prefix ?? "", limit);
    await touchInstance(ctx, task, instance, provider, false);
    return kvListOutputSchema.parse({
      instanceId: instance.id,
      items,
      total: items.length,
    });
  }

  if (toolPath === "kv.delete") {
    const parsed = kvDeleteInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    await provider.kvDelete(instance, parsed.key);
    await touchInstance(ctx, task, instance, provider, true);
    return kvDeleteOutputSchema.parse({
      instanceId: instance.id,
      key: parsed.key,
      ok: true,
    });
  }

  if (toolPath === "sqlite.query") {
    const parsed = sqliteQueryInputSchema.parse(payload);
    const instance = await resolveStorageInstance(ctx, task, payload);
    const provider = getStorageProvider(instance.provider);
    const mode = parsed.mode ?? "read";
    const maxRows = Math.max(1, Math.min(1_000, Math.floor(parsed.maxRows ?? 200)));
    const result = await provider.sqliteQuery(instance, {
      sql: parsed.sql,
      params: parsed.params ?? [],
      mode,
      maxRows,
    });
    await touchInstance(ctx, task, instance, provider, mode === "write");
    return sqliteQueryOutputSchema.parse({
      instanceId: instance.id,
      ...result,
    });
  }

  throw new Error(`Unsupported storage system tool: ${toolPath}`);
}
