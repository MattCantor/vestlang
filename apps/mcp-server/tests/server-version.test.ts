import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

// MCP requires a version in the initialize handshake, so every host sees this
// number and a user quoting it in a bug report is quoting this. Asserting it
// through a real handshake rather than off the object keeps the check honest
// about what a client actually receives.
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const manifestVersion = (
  JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf8")) as {
    version: string;
  }
).version;

describe("the version the server reports", () => {
  it("is the one in its manifest", async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0" });

    await Promise.all([
      createServer().connect(serverTransport),
      client.connect(clientTransport),
    ]);

    expect(client.getServerVersion()).toEqual({
      name: "vestlang-mcp-server",
      version: manifestVersion,
    });

    await client.close();
  });

  it("is not a literal anyone has to remember to bump", () => {
    const source = readFileSync(join(PACKAGE_DIR, "src/server.ts"), "utf8");
    expect(source).not.toMatch(/version:\s*["']\d+\.\d+\.\d+["']/);
  });
});
