import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startServeSkillsViaMcpDemoServer } from "./server";

const server = await startServeSkillsViaMcpDemoServer();
const client = new Client({
  name: "serve-skills-via-mcp-smoke",
  version: "1.0.0",
});
const transport = new StreamableHTTPClientTransport(new URL(server.endpoint));

try {
  await client.connect(transport);

  const resources = await client.listResources();
  console.log(`resources: ${resources.resources.length}`);
  for (const resource of resources.resources) {
    console.log(`- ${resource.uri}`);
  }

  const templates = await client.listResourceTemplates();
  console.log(`resourceTemplates: ${templates.resourceTemplates.length}`);
  for (const template of templates.resourceTemplates) {
    console.log(`- ${template.uriTemplate}`);
  }

  const catalog = await client.readResource({ uri: "skill://catalog/index.json" });
  const catalogText = "text" in catalog.contents[0]! ? catalog.contents[0]!.text : "";
  const parsedCatalog = JSON.parse(catalogText) as {
    readonly skills: ReadonlyArray<{
      readonly name: string;
      readonly manifestUri: string;
      readonly instructionsUri: string;
    }>;
  };

  const selectedSkill = parsedCatalog.skills[0]!;
  console.log(`selectedSkill: ${selectedSkill.name}`);

  const manifest = await client.readResource({ uri: selectedSkill.manifestUri });
  const manifestText = "text" in manifest.contents[0]! ? manifest.contents[0]!.text : "";
  const parsedManifest = JSON.parse(manifestText) as {
    readonly instructionsUri: string;
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly uri: string;
      readonly role: string;
    }>;
  };

  const instructions = await client.readResource({ uri: parsedManifest.instructionsUri });
  const instructionsText = "text" in instructions.contents[0]! ? instructions.contents[0]!.text : "";
  console.log(`instructionsPreview: ${instructionsText.split("\n").slice(0, 6).join("\n")}`);

  const supportFile = parsedManifest.files.find((file) => file.role !== "instructions");
  if (supportFile) {
    const support = await client.readResource({ uri: supportFile.uri });
    const supportText = "text" in support.contents[0]! ? support.contents[0]!.text : "";
    console.log(`supportFile: ${supportFile.path}`);
    console.log(`supportPreview: ${supportText.split("\n").slice(0, 4).join("\n")}`);
  }
} finally {
  await client.close().catch(() => undefined);
  await transport.close().catch(() => undefined);
  await server.close().catch(() => undefined);
}
