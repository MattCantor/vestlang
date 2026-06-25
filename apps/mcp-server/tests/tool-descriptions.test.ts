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

  it("names the remaining causes of an 'unrepresentable' verdict and notes event cliffs are excluded", async () => {
    const description = await descriptionOf("vestlang_evaluate");
    // Under #255 the EVENT_CLIFF cause is gone (an event-held cliff stores as a
    // template via event_condition); the remaining causes are DEFERRED_CLIFF and
    // EVENT_CHAINED_TAIL, described in prose mirroring the InterchangeVerdict doc.
    expect(description).toContain("until an event fires");
    expect(description).toContain("chained behind a start");
    // It must say an event-held cliff is NOT unrepresentable (it's a template).
    expect(description).toMatch(/event[- ]held cliff is NOT/i);
    expect(description).toContain("event_condition");
  });

  it("documents the recovered block surfaced on a rescue", async () => {
    const description = await descriptionOf("vestlang_evaluate");
    expect(description).toContain("`recovered`");
  });
});

describe("mcp-server / absenceAssumptions consequence in descriptions (#448)", () => {
  it("the evaluate and resolve_offset descriptions enumerate `consequence`", async () => {
    for (const tool of ["vestlang_evaluate", "vestlang_resolve_offset"]) {
      const description = await descriptionOf(tool);
      // The absence record now carries the grid-shift vs flips-to-impossible tag;
      // a client reading the description must see it listed alongside the other
      // fields.
      expect(description, tool).toContain("consequence");
    }
  });
});

describe("mcp-server / vestlang_evaluate_as_of description (#379)", () => {
  it("no longer advertises a cliff field in the summary roll-up", async () => {
    // The vestigial cliff-date summary field was removed, so the tool description
    // must not promise a cliff in its roll-up.
    const description = await descriptionOf("vestlang_evaluate_as_of");
    expect(description).not.toContain("cliff");
  });
});

describe("mcp-server / vestlang_evaluate_as_of validity channel in description", () => {
  it("documents the `valid` / `findings` validity channel", async () => {
    // The as-of read used to "carry no verdict"; it now reports the same
    // over-allocation verdict evaluate does, so the description must say so.
    const description = await descriptionOf("vestlang_evaluate_as_of");
    expect(description).toContain("`valid`");
    expect(description).toContain("`findings`");
    expect(description).toMatch(/allocates more than the grant/i);
    // The over-allocation example uses the 0.6 + 0.6 shape, not a cliff one — the
    // word "cliff" must still be absent (guarded above and re-asserted here).
    expect(description).not.toContain("cliff");
  });
});

describe("mcp-server / compile-does-not-certify-allocatability nudge (#431)", () => {
  it("vestlang_compile says it is the parse tool, not an allocatability oracle", async () => {
    const description = await descriptionOf("vestlang_compile");
    // It is the DSL → AST parse tool; producing the AST does not certify the
    // schedule fits the grant.
    expect(description).toMatch(/parse tool/i);
    expect(description).toMatch(/not an allocatability oracle/i);
    expect(description).toMatch(/does not certify/i);
  });

  it("the schedule-producing tools route the over-allocation answer to valid/findings", async () => {
    for (const tool of [
      "vestlang_evaluate",
      "vestlang_evaluate_as_of",
      "vestlang_vested_between",
    ]) {
      const description = await descriptionOf(tool);
      // The nudge: compiling/evaluating does not by itself certify the schedule
      // fits the grant — that answer is the valid/findings channel.
      expect(description, tool).toMatch(/does not by itself certify/i);
      expect(description, tool).toContain("`valid`");
      expect(description, tool).toContain("`findings`");
    }
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

describe("mcp-server / server INSTRUCTIONS unified envelope (#345, AC#7)", () => {
  it("names the `ok` success/refusal discriminant", async () => {
    const client = await connectedClient();
    const instructions = client.getInstructions() ?? "";
    // The two arms of the envelope are spelled out, keyed on `ok`.
    expect(instructions).toContain("ok: true");
    expect(instructions).toContain("ok: false");
  });

  it("references the `isError` exception boundary as distinct from `ok`", async () => {
    const client = await connectedClient();
    const instructions = client.getInstructions() ?? "";
    // The two-tier model: isError is the exception channel, separate from the
    // structured-refusal envelope.
    expect(instructions).toContain("isError");
    expect(instructions).toMatch(/isError[\s\S]*exception/i);
  });
});
