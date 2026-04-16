#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("vestlang-mcp: stdio transport ready");
}

main().catch((err) => {
  console.error("vestlang-mcp: fatal", err);
  process.exit(1);
});
