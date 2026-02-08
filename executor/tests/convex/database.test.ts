import { expect, test } from "bun:test";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

function setup() {
  return convexTest(schema, {
    "./database.ts": () => import("../../convex/database"),
    "./_generated/api.js": () => import("../../convex/_generated/api.js"),
  });
}

test("task lifecycle supports queue, run, and complete", async () => {
  const t = setup();
  const anonymous = await t.mutation(api.database.bootstrapAnonymousSession, {});
  const workspaceId = anonymous.workspaceId;

  const created = await t.mutation(api.database.createTask, {
    code: "console.log('hello')",
    runtimeId: "local-bun",
    workspaceId,
    actorId: "actor_1",
    clientId: "web",
  });

  expect(created.id).toBeDefined();
  expect(created.status).toBe("queued");

  const queued = await t.query(api.database.listQueuedTaskIds, { limit: 10 });
  expect(queued).toEqual([created.id]);

  const running = await t.mutation(api.database.markTaskRunning, { taskId: created.id });
  expect(running?.status).toBe("running");

  const secondRun = await t.mutation(api.database.markTaskRunning, { taskId: created.id });
  expect(secondRun).toBeNull();

  const finished = await t.mutation(api.database.markTaskFinished, {
    taskId: created.id,
    status: "completed",
    stdout: "ok",
    stderr: "",
    exitCode: 0,
  });
  expect(finished?.status).toBe("completed");

  const queuedAfter = await t.query(api.database.listQueuedTaskIds, { limit: 10 });
  expect(queuedAfter).toEqual([]);
});

test("approval lifecycle tracks pending and resolution", async () => {
  const t = setup();
  const anonymous = await t.mutation(api.database.bootstrapAnonymousSession, {});
  const workspaceId = anonymous.workspaceId;

  const createdTask = await t.mutation(api.database.createTask, {
    code: "await tools.admin.delete_data({ id: 'x' })",
    runtimeId: "local-bun",
    workspaceId,
    actorId: "actor_2",
    clientId: "web",
  });

  const createdApproval = await t.mutation(api.database.createApproval, {
    taskId: createdTask.id,
    toolPath: "admin.delete_data",
    input: { id: "x" },
  });
  expect(createdApproval.status).toBe("pending");

  const pending = await t.query(api.database.listPendingApprovals, { workspaceId });
  expect(pending.length).toBe(1);
  expect(pending[0]?.task.id).toBe(createdTask.id);

  const resolved = await t.mutation(api.database.resolveApproval, {
    approvalId: createdApproval.id,
    decision: "approved",
    reviewerId: "reviewer_1",
  });
  expect(resolved?.status).toBe("approved");

  const pendingAfter = await t.query(api.database.listPendingApprovals, { workspaceId });
  expect(pendingAfter).toEqual([]);
});

test("anonymous bootstrap links guest account membership", async () => {
  const t = setup();

  const first = await t.mutation(api.database.bootstrapAnonymousSession, {});
  expect(first.sessionId).toContain("anon_session_");
  expect(first.workspaceId).toBeDefined();
  expect(first.actorId).toContain("anon_");
  expect(first.accountId).toBeDefined();

  const again = await t.mutation(api.database.bootstrapAnonymousSession, {
    sessionId: first.sessionId,
  });

  expect(again.sessionId).toBe(first.sessionId);
  expect(again.accountId).toBe(first.accountId);
  expect(again.workspaceId).toBe(first.workspaceId);
});

test("bootstrap honors caller-provided session id", async () => {
  const t = setup();

  const seeded = await t.mutation(api.database.bootstrapAnonymousSession, {
    sessionId: "assistant-discord-dev",
  });

  expect(seeded.sessionId).toBe("assistant-discord-dev");

  const again = await t.mutation(api.database.bootstrapAnonymousSession, {
    sessionId: "assistant-discord-dev",
  });

  expect(again.sessionId).toBe("assistant-discord-dev");
  expect(again.workspaceId).toBe(seeded.workspaceId);
  expect(again.actorId).toBe(seeded.actorId);
});
