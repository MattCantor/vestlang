import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Tool descriptions are the behavioral contract LLM clients act on, so a stale one
// is a real defect. This guards the `vestlang_evaluate` description against the #242
// regression: it claimed the `unrepresentable` interchange verdict had "today only
// an event-anchored cliff" when the code (types/evaluation.ts InterchangeVerdict,
// evaluator/resolve/interchange.ts) has three causes.

async function descriptionOf(toolName: string): Promise<string> {
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const { tools } = await client.listTools();
  const tool = tools.find((t) => t.name === toolName);
  expect(tool, `tool ${toolName} should be registered`).toBeDefined();
  return tool!.description ?? "";
}

describe("mcp-server / vestlang_evaluate description (#242)", () => {
  it("does not understate the 'unrepresentable' verdict", async () => {
    const description = await descriptionOf("vestlang_evaluate");
    // The stale claim — and any "today only … cliff" understatement of it.
    expect(description).not.toContain("today only an event-anchored cliff");
    expect(description).not.toMatch(/today only.*cliff/i);
  });

  it("names all three causes of an 'unrepresentable' verdict", async () => {
    const description = await descriptionOf("vestlang_evaluate");
    // EVENT_CLIFF, DEFERRED_CLIFF, EVENT_CHAINED_TAIL — described in prose,
    // mirroring the InterchangeVerdict doc in @vestlang/types.
    expect(description).toContain("event-anchored cliff");
    expect(description).toContain("until an event fires");
    expect(description).toContain("chained behind a start");
  });

  it("documents the recovered block surfaced on a rescue", async () => {
    const description = await descriptionOf("vestlang_evaluate");
    expect(description).toContain("`recovered`");
  });
});
