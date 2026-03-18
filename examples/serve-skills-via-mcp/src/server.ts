import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import {
  type DistributedSkillBundle,
  findBundleByName,
  findBundleFile,
  getCatalogUri,
  getFileTemplate,
  loadDistributedSkillBundles,
  readBundleFileText,
  renderCatalog,
} from "./catalog";

export type ServeSkillsViaMcpDemoServer = {
  readonly endpoint: string;
  readonly close: () => Promise<void>;
};

const registerSkillResources = (
  server: McpServer,
  bundles: readonly DistributedSkillBundle[],
) => {
  server.registerResource(
    "skill-catalog",
    getCatalogUri(),
    {
      title: "Distributed Agent Skills Catalog",
      description: "Catalog of skill bundles exposed over MCP resources.",
      mimeType: "application/json",
      annotations: {
        audience: ["assistant", "user"],
        priority: 0.7,
      },
    },
    async () => ({
      contents: [
        {
          uri: getCatalogUri(),
          mimeType: "application/json",
          text: renderCatalog(bundles),
        },
      ],
    }),
  );

  for (const bundle of bundles) {
    server.registerResource(
      `${bundle.skill.name}-manifest`,
      bundle.manifestUri,
      {
        title: `${bundle.skill.name} manifest`,
        description: `Distribution manifest for ${bundle.skill.name}.`,
        mimeType: "application/json",
        annotations: {
          audience: ["assistant"],
          priority: 0.85,
        },
      },
      async () => ({
        contents: [
          {
            uri: bundle.manifestUri,
            mimeType: "application/json",
            text: JSON.stringify(bundle.manifest, null, 2),
          },
        ],
      }),
    );

    server.registerResource(
      `${bundle.skill.name}-instructions`,
      bundle.instructionsUri,
      {
        title: `${bundle.skill.name} SKILL.md`,
        description: bundle.skill.description,
        mimeType: "text/markdown",
        annotations: {
          audience: ["assistant"],
          priority: 1,
        },
      },
      async () => ({
        contents: [
          {
            uri: bundle.instructionsUri,
            mimeType: "text/markdown",
            text: await readBundleFileText(bundle, "SKILL.md"),
          },
        ],
      }),
    );
  }

  server.registerResource(
    "skill-bundle-file",
    new ResourceTemplate(getFileTemplate(), {
      list: undefined,
      complete: {
        skill: (value) =>
          bundles
            .map((bundle) => bundle.skill.name)
            .filter((skillName) => skillName.startsWith(value)),
        version: (value, context) => {
          const skillName = context?.arguments?.skill;
          if (!skillName) {
            return bundles
              .map((bundle) => bundle.version)
              .filter((version) => version.startsWith(value));
          }

          const bundle = findBundleByName(bundles, skillName);
          if (!bundle) {
            return [];
          }

          return bundle.version.startsWith(value) ? [bundle.version] : [];
        },
        path: (value, context) => {
          const skillName = context?.arguments?.skill;
          const version = context?.arguments?.version;
          if (!skillName || !version) {
            return [];
          }

          const bundle = bundles.find((entry) =>
            entry.skill.name === skillName && entry.version === version
          );
          if (!bundle) {
            return [];
          }

          return bundle.files
            .map((file) => file.path)
            .filter((filePath) => filePath.startsWith(value));
        },
      },
    }),
    {
      title: "Skill bundle files",
      description: "Read any file inside a distributed skill bundle.",
      mimeType: "text/plain",
      annotations: {
        audience: ["assistant"],
        priority: 0.5,
      },
    },
    async (_uri, variables) => {
      const skillName = typeof variables.skill === "string" ? variables.skill : undefined;
      const version = typeof variables.version === "string" ? variables.version : undefined;
      const filePath = typeof variables.path === "string" ? variables.path : undefined;

      if (!skillName || !version || !filePath) {
        throw new Error("Expected skill, version, and path variables");
      }

      const bundle = bundles.find((entry) =>
        entry.skill.name === skillName && entry.version === version
      );
      const file = findBundleFile(bundles, skillName, version, filePath);
      if (!bundle || !file) {
        throw new Error(`Unknown distributed skill file: ${skillName}@${version}/${filePath}`);
      }

      return {
        contents: [
          {
            uri: file.uri,
            mimeType: file.mimeType,
            text: await readBundleFileText(bundle, filePath),
          },
        ],
      };
    },
  );
};

const createSessionServer = (bundles: readonly DistributedSkillBundle[]): McpServer => {
  const server = new McpServer(
    {
      name: "executor-serve-skills-via-mcp-demo",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {
          listChanged: true,
        },
      },
      instructions: [
        "This server demonstrates one way to distribute Agent Skills over MCP resources.",
        "Read the catalog and a skill manifest first, then load SKILL.md only when you decide to activate that skill.",
      ].join(" "),
    },
  );

  registerSkillResources(server, bundles);
  return server;
};

const resolveSessionId = (headers: Record<string, string | string[] | undefined>): string | undefined => {
  const value = headers["mcp-session-id"];
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
};

const listen = async (app: ReturnType<typeof createMcpExpressApp>, port: number, host: string) =>
  new Promise<HttpServer>((resolve, reject) => {
    const listener = app.listen(port, host);

    const onListening = () => {
      listener.off("error", onError);
      resolve(listener);
    };

    const onError = (error: Error) => {
      listener.off("listening", onListening);
      reject(error);
    };

    listener.once("listening", onListening);
    listener.once("error", onError);
  });

export const startServeSkillsViaMcpDemoServer = async (input: {
  readonly host?: string;
  readonly port?: number;
} = {}): Promise<ServeSkillsViaMcpDemoServer> => {
  const host = input.host ?? "127.0.0.1";
  const bundles = await loadDistributedSkillBundles();
  const app = createMcpExpressApp({ host });
  const transports: Record<string, StreamableHTTPServerTransport> = {};
  const servers: Record<string, McpServer> = {};

  app.post("/mcp", async (req: any, res: any) => {
    const sessionId = resolveSessionId(req.headers);

    try {
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        transport = transports[sessionId];
      } else {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
          },
        });

        transport.onclose = () => {
          const closedSessionId = transport.sessionId;
          if (closedSessionId && transports[closedSessionId]) {
            delete transports[closedSessionId];
          }
          if (closedSessionId && servers[closedSessionId]) {
            void servers[closedSessionId].close().catch(() => undefined);
            delete servers[closedSessionId];
          }
        };

        const server = createSessionServer(bundles);
        await server.connect(transport);
        if (transport.sessionId) {
          servers[transport.sessionId] = server;
        }
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req: any, res: any) => {
    const sessionId = resolveSessionId(req.headers);
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    await transports[sessionId].handleRequest(req, res);
  });

  app.delete("/mcp", async (req: any, res: any) => {
    const sessionId = resolveSessionId(req.headers);
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    const transport = transports[sessionId];
    await transport.handleRequest(req, res, req.body);
    await transport.close();
    delete transports[sessionId];

    if (servers[sessionId]) {
      await servers[sessionId].close().catch(() => undefined);
      delete servers[sessionId];
    }
  });

  const listener = await listen(app, input.port ?? 0, host);
  const address = listener.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve, reject) => {
      listener.close((error) => (error ? reject(error) : resolve()));
    });
    throw new Error("Failed to resolve serve-skills-via-mcp demo address");
  }

  return {
    endpoint: `http://${host}:${address.port}/mcp`,
    close: async () => {
      for (const transport of Object.values(transports)) {
        await transport.close().catch(() => undefined);
      }

      for (const server of Object.values(servers)) {
        await server.close().catch(() => undefined);
      }

      await new Promise<void>((resolve, reject) => {
        listener.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
};
