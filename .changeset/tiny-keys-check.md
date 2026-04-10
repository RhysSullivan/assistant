---
"executor": patch
---

### Features

- Support manual HTTP headers when adding GraphQL, MCP, and OpenAPI remote sources (#135)

### Bug Fixes

- Fix MCP tools hanging when elicitation or multiple resumes are required (#126)
- Harden OAuth popup handshake for Google Discovery and MCP sources (#141)
- Return cleaner HTTP error messages from plugins instead of leaking internal details (#137)
