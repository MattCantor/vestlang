import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

// A schedule with a huge derived occurrence count used to materialize one
// installment per occurrence and take the server process down (stack overflow /
// OOM). The engine now caps the total and rejects before building anything;
// these tests confirm the cap returns a clean error instead of crashing, and
// that ordinary schedules are unaffected.

type CallResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

async function connectClient(): Promise<Client> {
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

const callEval = (client: Client, tool: string, dsl: string) =>
  client.callTool({
    name: tool,
    arguments: { dsl, grant_date: "2025-01-01", grant_quantity: 1000 },
  }) as Promise<CallResult>;

const evaluate = (client: Client, dsl: string) =>
  callEval(client, "vestlang_evaluate", dsl);

const errorOf = (res: CallResult) =>
  (res.structuredContent as { error?: { message?: string } })?.error;

describe("mcp-server / installment cap", () => {
  it("rejects a schedule that expands past the cap instead of crashing", async () => {
    const client = await connectClient();
    const res = await evaluate(
      client,
      "VEST OVER 1000000 months EVERY 1 month",
    );
    const error = (res.structuredContent as { error?: { message?: string } })
      ?.error;
    expect(error?.message).toMatch(/exceeds the limit/);
  });

  it("rejects when many PLUS components together exceed the cap", async () => {
    const client = await connectClient();
    // Two 6000-occurrence trains: each is fine alone, the sum is not.
    const res = await evaluate(
      client,
      "VEST OVER 6000 days EVERY 1 day PLUS VEST OVER 6000 days EVERY 1 day",
    );
    const error = (res.structuredContent as { error?: { message?: string } })
      ?.error;
    expect(error?.message).toMatch(/exceeds the limit/);
  });

  it("caps an unresolved (event-anchored) schedule too", async () => {
    // No `ipo` event: the start is unresolved, but occurrences is structural —
    // the cap must fire on the count, not trip over resolution.
    const client = await connectClient();
    const res = await evaluate(
      client,
      "VEST FROM EVENT ipo OVER 1000000 months EVERY 1 month",
    );
    expect(errorOf(res)?.message).toMatch(/exceeds the limit/);
  });

  it("still evaluates an ordinary schedule", async () => {
    const client = await connectClient();
    const res = await evaluate(client, "VEST OVER 48 months EVERY 1 month");
    const sc = res.structuredContent as {
      statements?: { installments: unknown[] }[];
      error?: unknown;
    };
    expect(sc.error).toBeUndefined();
    expect(sc.statements?.[0].installments).toHaveLength(48);
  });

  // The per-statement and whole-program tools enforce the cap by the same exact
  // measure, so they must agree on a borderline program — neither rejects what
  // the other accepts.
  it("vestlang_evaluate and vestlang_evaluate_program agree on an over-cap program", async () => {
    const client = await connectClient();
    const dsl =
      "VEST OVER 6000 days EVERY 1 day PLUS VEST OVER 6000 days EVERY 1 day";
    const perStatement = errorOf(await evaluate(client, dsl));
    const program = errorOf(
      await callEval(client, "vestlang_evaluate_program", dsl),
    );
    expect(perStatement?.message).toMatch(/exceeds the limit/);
    expect(program?.message).toMatch(/exceeds the limit/);
    expect(program?.message).toBe(perStatement?.message);
  });
});
