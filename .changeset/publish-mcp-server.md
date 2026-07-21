---
"@vestlang/mcp-server": minor
---

Publish the MCP server to npm. An MCP host can now launch it with
`npx -y @vestlang/mcp-server` — no clone, no build. The private workspace
packages are bundled into the published artifact, so the only runtime
dependencies are `@modelcontextprotocol/sdk` and `zod`.
