import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Checks that the evaluate tools surface an over-allocation: the schedule reads
// `valid: false` and carries a structured + human-readable finding, while the
// projection is still returned (annotate, don't certify). The detection itself is
// covered in @vestlang/evaluator; here we only check the tool layer exposes it.

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

type Finding = { kind: string; severity: string; message: string };

describe("mcp-server / over-allocation surfacing", () => {
  // 3/4 + 3/4 = 150% of the grant.
  const dsl =
    "3/4 VEST FROM DATE 2025-01-01 OVER 1 year EVERY 1 year PLUS 3/4 VEST FROM DATE 2025-06-01 OVER 1 year EVERY 1 year";

  it("evaluate_program reports valid: false with an over-allocation finding", async () => {
    const client = await connectClient();
    const res = (await client.callTool({
      name: "vestlang_evaluate_program",
      arguments: { dsl, grant_date: "2025-01-01", grant_quantity: 1000 },
    })) as CallResult;

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      valid: boolean;
      findings: Finding[];
      installments: unknown[];
    };
    expect(sc.valid).toBe(false);
    expect(sc.findings).toHaveLength(1);
    expect(sc.findings[0].kind).toBe("over-allocation");
    expect(sc.findings[0].severity).toBe("error");
    expect(sc.findings[0].message).toContain("150%");
    // Annotate, don't certify: the projection is still returned, not suppressed.
    expect(sc.installments.length).toBeGreaterThan(0);
  });

  it("evaluate (per-statement) leaves a well-formed grant valid with no findings", async () => {
    const client = await connectClient();
    const res = (await client.callTool({
      name: "vestlang_evaluate",
      arguments: {
        dsl: "VEST FROM DATE 2025-01-01 OVER 1 year EVERY 1 year",
        grant_date: "2025-01-01",
        grant_quantity: 1000,
      },
    })) as CallResult;

    const sc = res.structuredContent as {
      statements: { valid: boolean; findings: Finding[] }[];
    };
    expect(sc.statements[0].valid).toBe(true);
    expect(sc.statements[0].findings).toEqual([]);
  });
});
