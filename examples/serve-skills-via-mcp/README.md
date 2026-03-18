# Serve Skills Via MCP

This demo shows one practical way to distribute [Agent Skills](https://agentskills.io)
over MCP resources.

It exposes:

- a catalog resource that lists available skill bundles
- one manifest resource per skill bundle
- one direct `SKILL.md` resource per bundle
- a `skill://demo/{skill}/{version}/{+path}` resource template for bundled files

The important boundary is that MCP resources only transport the bundle. The host still
owns activation logic:

1. list resources
2. read the catalog or a manifest
3. choose a skill
4. read that skill's `SKILL.md`
5. fetch additional files from the manifest on demand

## Run

```bash
bun run --filter @executor/serve-skills-via-mcp-demo start
```

The server listens on `http://127.0.0.1:<port>/mcp` and logs the final endpoint to
stderr.

## Smoke Test

```bash
bun run --filter @executor/serve-skills-via-mcp-demo smoke
```

The smoke script starts the server, connects with an MCP client, lists resources,
reads a skill manifest, then reads `SKILL.md` and one support file.
