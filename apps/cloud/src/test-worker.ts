// Minimal entrypoint for the vitest-pool-workers test worker. The tests
// run inside this worker's module scope, so all we need is a placeholder
// fetch handler — we don't exercise it directly.
export default {
  async fetch(): Promise<Response> {
    return new Response("test-worker", { status: 200 });
  },
};
