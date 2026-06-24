import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// The as-of read tools (evaluate_as_of, vested_between) carry the same validity
// channel as evaluate: `valid` plus a `findings` array shaped `{ ...finding,
// message }`. An over-allocating program still returns its partition and window
// sum (annotate, don't certify), flagged invalid. The detection lives in the
// evaluator/pipeline; here we only check the tool layer exposes it.

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

type Finding = {
  kind: string;
  severity: string;
  sum: { numerator: number; denominator: number };
  message: string;
};

// Two 0.6 grids on the same grant reach 120% (6/5).
const OVER_ALLOCATES =
  "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month PLUS " +
  "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";

describe("mcp-server / vestlang_evaluate_as_of validity channel", () => {
  it("exposes valid:false and a structured + rendered finding", async () => {
    const client = await connectClient();
    const res = (await client.callTool({
      name: "vestlang_evaluate_as_of",
      arguments: {
        dsl: OVER_ALLOCATES,
        grant_date: "2025-01-01",
        grant_quantity: 1200,
        as_of: "2027-01-01",
      },
    })) as CallResult;

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      valid: boolean;
      findings: Finding[];
      summary: { percent_vested: number; fully_vested_date: string | null };
    };
    expect(sc.valid).toBe(false);
    expect(sc.findings).toHaveLength(1);
    const [f] = sc.findings;
    expect(f.kind).toBe("over-allocation");
    expect(f.severity).toBe("error");
    // The raw fraction is carried alongside the rendered sentence.
    expect(f.sum).toEqual({ numerator: 6, denominator: 5 });
    expect(f.message).toBe(
      "over-allocates the grant to 120% (6/5) — not a valid schedule",
    );
    // The summary stays honest, with only the completion date suppressed.
    expect(sc.summary.percent_vested).toBe(1.2);
    expect(sc.summary.fully_vested_date).toBeNull();
  });

  it("leaves a valid program valid with no findings", async () => {
    const client = await connectClient();
    const res = (await client.callTool({
      name: "vestlang_evaluate_as_of",
      arguments: {
        dsl: "VEST OVER 12 months EVERY 1 month",
        grant_date: "2025-01-01",
        grant_quantity: 1200,
        as_of: "2027-01-01",
      },
    })) as CallResult;

    const sc = res.structuredContent as { valid: boolean; findings: Finding[] };
    expect(sc.valid).toBe(true);
    expect(sc.findings).toEqual([]);
  });
});

describe("mcp-server / vestlang_vested_between validity channel", () => {
  it("exposes valid:false with the finding; window sum stays unclamped", async () => {
    const client = await connectClient();
    const res = (await client.callTool({
      name: "vestlang_vested_between",
      arguments: {
        dsl: OVER_ALLOCATES,
        grant_date: "2025-01-01",
        grant_quantity: 1200,
        from: "2025-01-01",
        to: "2027-01-01",
      },
    })) as CallResult;

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      valid: boolean;
      findings: Finding[];
      vested_in_window: number;
    };
    expect(sc.valid).toBe(false);
    expect(sc.findings.some((f) => f.kind === "over-allocation")).toBe(true);
    // The real total across the window — 1440 shares, not clamped to the grant.
    expect(sc.vested_in_window).toBe(1440);
  });
});
