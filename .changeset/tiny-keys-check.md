---
"executor": patch
---

### Features

- Edit source configuration support for OpenAPI, GraphQL, MCP, and Google Discovery (#143, #144, #145, #146)
- Support manual HTTP headers when adding GraphQL, MCP, and OpenAPI remote sources (#135)
- High-contrast syntax highlighting with light/dark pair (#162)
- Improved OpenAPI parser and source add flow (#175)

### Bug Fixes

- Fix two independent hanging-write bugs in the execution engine and local Bun server (#158)
- Fix MCP tools hanging when elicitation or multiple resumes are required (#126)
- Harden OAuth popup handshake for Google Discovery and MCP sources (#141)
- Return cleaner HTTP error messages from plugins instead of leaking internal details (#137)
- Correct and backfill preset icon URLs (#161)

### Improvements

- Switch sans font from DM Sans to Inter (#160)
- Batch KV set and delete operations (#173)
