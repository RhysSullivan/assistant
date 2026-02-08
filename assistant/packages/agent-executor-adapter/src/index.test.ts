import { expect, test } from "bun:test";
import { Elysia, t } from "elysia";
import { treaty } from "@elysiajs/eden";

// Minimal Elysia server that mimics the executor's task creation route
function createTestServer() {
  return new Elysia()
    .get("/api/health", () => ({ ok: true as const, tools: 5 }))
    .post("/api/tasks", ({ body }) => ({
      taskId: "task_test_1",
      status: "queued" as const,
    }), {
      body: t.Object({
        code: t.String(),
        timeoutMs: t.Optional(t.Number()),
        runtimeId: t.Optional(t.String()),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
        workspaceId: t.String(),
        actorId: t.String(),
        clientId: t.Optional(t.String()),
      }),
    })
    .post("/api/auth/anonymous/bootstrap", ({ body }) => ({
      sessionId: body.sessionId ?? "sess_test",
      workspaceId: "ws_anon",
      actorId: "actor_anon",
      clientId: "client_anon",
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    }), {
      body: t.Object({
        sessionId: t.Optional(t.String()),
      }),
    })
    .listen(0);
}

test("Eden Treaty client can create a task with full type safety", async () => {
  const server = createTestServer();
  const client = treaty<typeof server>(`http://127.0.0.1:${server.server!.port}`);

  try {
    const { data, error } = await client.api.tasks.post({
      code: "console.log('hello')",
      workspaceId: "ws_test",
      actorId: "actor_test",
    });

    expect(error).toBeNull();
    expect(data!.taskId).toBe("task_test_1");
    expect(data!.status).toBe("queued");
  } finally {
    server.stop(true);
  }
});

test("Eden Treaty client can check health", async () => {
  const server = createTestServer();
  const client = treaty<typeof server>(`http://127.0.0.1:${server.server!.port}`);

  try {
    const { data, error } = await client.api.health.get();

    expect(error).toBeNull();
    expect(data!.ok).toBe(true);
    expect(data!.tools).toBe(5);
  } finally {
    server.stop(true);
  }
});

test("Eden Treaty client can bootstrap anonymous context", async () => {
  const server = createTestServer();
  const client = treaty<typeof server>(`http://127.0.0.1:${server.server!.port}`);

  try {
    const { data, error } = await client.api.auth.anonymous.bootstrap.post({
      sessionId: "my-session",
    });

    expect(error).toBeNull();
    expect(data!.workspaceId).toBe("ws_anon");
    expect(data!.sessionId).toBe("my-session");
  } finally {
    server.stop(true);
  }
});
