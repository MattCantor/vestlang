#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs, readHttpConfig } from "./cli.js";
import { startHttpServer } from "./http.js";
import { createServer } from "./server.js";

// How long a shutdown may take before we stop being polite about it.
const SHUTDOWN_GRACE_MS = 10_000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function startStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("vestlang-mcp: stdio transport ready");
}

async function startHttp(): Promise<void> {
  const result = readHttpConfig(process.env);
  if (!result.ok) fail(result.message);
  const { config } = result;

  const { shutdown } = await startHttpServer(config);

  console.error(
    `vestlang-mcp: streamable HTTP transport listening on http://${config.host}:${config.port}/mcp`,
  );
  console.error(
    config.allowedHosts
      ? `vestlang-mcp: Host header allowlist: ${config.allowedHosts.join(", ")}`
      : "vestlang-mcp: no Host header allowlist set — the SDK protects localhost binds; set VESTLANG_MCP_ALLOWED_HOSTS when binding wider",
  );

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      console.error(`vestlang-mcp: ${signal} received, shutting down`);
      // Bound the wait regardless of what clients are doing. Unref'd, so it never
      // holds the loop open by itself — it only fires if something else does.
      setTimeout(() => {
        console.error("vestlang-mcp: shutdown timed out, exiting");
        process.exit(1);
      }, SHUTDOWN_GRACE_MS).unref();

      shutdown().then(
        () => process.exit(0),
        (err: unknown) => {
          console.error("vestlang-mcp: shutdown failed", err);
          process.exit(1);
        },
      );
    });
  }
}

async function main(): Promise<void> {
  const invocation = parseArgs(process.argv.slice(2));
  switch (invocation.mode) {
    case "stdio":
      await startStdio();
      return;
    case "http":
      await startHttp();
      return;
    case "usage-error":
      fail(invocation.message);
  }
}

main().catch((err) => {
  console.error("vestlang-mcp: fatal", err);
  process.exit(1);
});
