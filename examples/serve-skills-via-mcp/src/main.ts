import { startServeSkillsViaMcpDemoServer } from "./server";

const host = process.env.HOST ?? "127.0.0.1";
const port = process.env.PORT ? Number(process.env.PORT) : 58507;

const server = await startServeSkillsViaMcpDemoServer({ host, port });
console.error(`serve-skills-via-mcp listening on ${server.endpoint}`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});
