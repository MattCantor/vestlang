import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { VESTLANG_GRAMMAR_GUIDE } from "@vestlang/vestlang/authoring";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Everything here goes through the real server: the URIs come from the protocol
// listing rather than the exported array, so a registration the manifest doesn't
// describe still gets read.

let client: Client;
let uris: string[];

async function textOf(uri: string): Promise<string> {
  const result = await client.readResource({ uri });
  return result.contents
    .map((c) => ("text" in c ? String(c.text) : ""))
    .join("");
}

beforeAll(async () => {
  const server = createServer();
  client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  uris = (await client.listResources()).resources.map((r) => r.uri);
});

describe("the MCP resource surface", () => {
  it("lists resources", () => {
    expect(uris.length).toBeGreaterThan(0);
  });

  it("serves non-empty text for every listed URI", async () => {
    for (const uri of uris) {
      expect((await textOf(uri)).trim().length, uri).toBeGreaterThan(0);
    }
  });

  // Equality, not a substring of prose: a served body that merely quotes the
  // guide would satisfy a containment check while drifting from it.
  it("serves the published grammar guide at vestlang://docs/grammar", async () => {
    expect(await textOf("vestlang://docs/grammar")).toBe(
      VESTLANG_GRAMMAR_GUIDE,
    );
  });
});
