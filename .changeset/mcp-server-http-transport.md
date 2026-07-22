---
"@vestlang/mcp-server": minor
---

The MCP server can now serve over Streamable HTTP as well as stdio, for running vestlang
as a shared service inside your own network: `npx -y @vestlang/mcp-server --http` listens
on `POST /mcp` with a `GET /health` probe. Configure it with `VESTLANG_MCP_PORT` (default
`3000`), `VESTLANG_MCP_HOST` (default `127.0.0.1`) and `VESTLANG_MCP_ALLOWED_HOSTS`.

It is stateless — a fresh server and transport per request — and ships unauthenticated, so
the network perimeter is yours to own; the README covers the security posture and the
deployment shapes. With no arguments the server still speaks stdio exactly as before,
though an unrecognized argument is now a usage error instead of being ignored.
