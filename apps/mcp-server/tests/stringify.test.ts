import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

// These tests exercise the MCP tool layer for `vestlang_stringify`. The
// stringify *logic* lives in @vestlang/render; here we only pin the handler's
// argument handling — in particular that an `ast` arrived as a JSON string
// (some MCP clients serialize a structured `unknown` argument that way) is
// accepted, not rejected. Regression for the handler that fed the raw string
// straight to stringify and crashed on every input.

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

/** Compile DSL through the tool layer and return the normalized Program. */
async function programFromDsl(client: Client, dsl: string): Promise<unknown> {
  const res = (await client.callTool({
    name: "vestlang_compile",
    arguments: { dsl },
  })) as CallResult;
  return (res.structuredContent as { program: unknown }).program;
}

async function callStringify(
  client: Client,
  ast: unknown,
): Promise<CallResult> {
  return client.callTool({
    name: "vestlang_stringify",
    arguments: { ast },
  }) as Promise<CallResult>;
}

describe("mcp-server / vestlang_stringify tool layer", () => {
  it("stringifies an AST passed as an object", async () => {
    const client = await connectClient();
    const program = await programFromDsl(
      client,
      `VEST OVER 48 months EVERY 1 month`,
    );

    const res = await callStringify(client, program);
    expect(res.isError).toBeFalsy();
    const dsl = (res.structuredContent as { dsl?: string }).dsl;
    expect(typeof dsl).toBe("string");
    expect(dsl).toContain("OVER 48 months EVERY 1 month");
  });

  it("accepts an AST passed as a JSON string and produces the same DSL", async () => {
    const client = await connectClient();
    const program = await programFromDsl(
      client,
      `VEST OVER 48 months EVERY 1 month`,
    );

    const fromObject = (
      (await callStringify(client, program)).structuredContent as {
        dsl: string;
      }
    ).dsl;
    const fromString = (await callStringify(client, JSON.stringify(program)))
      .structuredContent as { dsl?: string };

    expect(fromString.dsl).toBe(fromObject);
  });

  it("re-compiles to the same program (round-trips through stringify)", async () => {
    const client = await connectClient();
    const src = `100 VEST FROM EVENT grant THEN 200 VEST OVER 12 months EVERY 1 month`;
    const program = await programFromDsl(client, src);

    const dsl = (
      (await callStringify(client, program)).structuredContent as {
        dsl: string;
      }
    ).dsl;
    const recompiled = await programFromDsl(client, dsl);
    expect(recompiled).toEqual(program);
  });

  it("reports a clean error for a malformed JSON string", async () => {
    const client = await connectClient();
    const res = await callStringify(client, "{ not json");
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Stringify failed/);
  });

  it("rejects a raw (un-normalized) parse AST instead of crashing", async () => {
    // A bare-DURATION cliff is what vestlang_parse emits; vestlang_compile
    // resolves it to a node. Feeding the raw shape must fail with a clear
    // message, not the cryptic "reading 'kind'" Doc-printer crash.
    const client = await connectClient();
    const rawAst = [
      {
        type: "STATEMENT",
        amount: { type: "PORTION", numerator: 1, denominator: 1 },
        expr: {
          type: "SCHEDULE",
          vesting_start: {
            type: "NODE",
            base: { type: "EVENT", value: "grant" },
            offsets: [],
          },
          periodicity: {
            type: "MONTHS",
            length: 1,
            occurrences: 48,
            cliff: {
              type: "DURATION",
              value: 12,
              unit: "MONTHS",
              sign: "PLUS",
            },
          },
        },
      },
    ];

    const res = await callStringify(client, rawAst);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/un-normalized/);
    expect(res.content[0].text).not.toMatch(/reading 'kind'/);
  });
});
