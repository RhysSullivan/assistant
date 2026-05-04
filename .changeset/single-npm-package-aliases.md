---
"executor": patch
---

Switch the npm packaging to a single-package + version-aliases shape (codex pattern). All platform variants now publish under one npm name (`executor`) with platform-tagged versions (`1.4.14-linux-x64`, `1.4.14-darwin-arm64`, ...), referenced from the wrapper's `optionalDependencies` via `npm:` alias specs. No new package names to claim or configure trusted publishing for.
