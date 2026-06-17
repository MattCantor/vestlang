import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Tool descriptions are the behavioral contract LLM clients act on, so a stale one
// is a real defect. This guards the `vestlang_evaluate` description against the #242
// regression: it claimed the `unrepresentable` interchange verdict had "today only
// an event-anchored cliff" when the code (types/evaluation.ts InterchangeVerdict,
// evaluator/resolve/interchange.ts) has three causes.

async function connectedClient(): Promise<Client> {
  const server = createServer();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

async function descriptionOf(toolName: string): Promise<string> {
  const client = await connectedClient();
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

describe("mcp-server / server INSTRUCTIONS error-shape paragraph (#296, AC#8)", () => {
  it("no longer enumerates only the two syntax/evaluation ruleIds", async () => {
    const client = await connectedClient();
    const instructions = client.getInstructions() ?? "";
    // It still describes the structured { error: { ruleId, message } } shape and
    // names syntax-error...
    expect(instructions).toMatch(/ruleId/);
    expect(instructions).toContain("syntax-error");
    // ...but it's no longer pinned to exactly those two: the pre-#296 text read
    // ` or "evaluation-error" for`, framing the two as the whole list. Now other
    // tool-specific ruleIds (e.g. offset-*) flow through the same shape.
    expect(instructions).not.toMatch(/or "evaluation-error" for/);
  });
});
