import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Installment, ResolvedInstallment } from "@vestlang/types";
import { createServer } from "../src/server.js";

// The inferrer advertises an "always round-trip verified" guarantee, but it
// verifies through the whole-program collapse while a consumer re-evaluates the
// emitted DSL through vestlang_evaluate — which computes a per-statement breakdown,
// the path that once threw on any THEN chain the inferrer emitted (#143). These
// tests close the gap end to end at the MCP boundary: infer a schedule, then
// forward the tool's own `context` object straight into vestlang_evaluate, so the
// day-of-month never has to be re-plucked and re-supplied by hand.

type CallResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

type Tranche = { date: string; amount: number };

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

/** Infer a schedule through the tool, then evaluate the emitted DSL by forwarding
 *  the tool's own `context` object — the passthrough the tool is designed for, with
 *  nothing re-derived from the test's own setup. */
async function inferThenEvaluate(tranches: Tranche[], grantDate: string) {
  const client = await connectClient();
  const inferRes = (await client.callTool({
    name: "vestlang_infer_schedule",
    arguments: { tranches, grant_date: grantDate },
  })) as CallResult;
  const inferSc = inferRes.structuredContent as {
    dsl: string;
    context: Record<string, unknown>;
  };

  const evalRes = (await client.callTool({
    name: "vestlang_evaluate",
    arguments: { dsl: inferSc.dsl, ...inferSc.context },
  })) as CallResult;
  const evalSc = evalRes.structuredContent as {
    resolvesTo: { status: string };
    installments: Installment[];
    breakdown: unknown[];
  };
  return { dsl: inferSc.dsl, evalSc };
}

const sumOf = (tranches: Tranche[]) =>
  tranches.reduce((n, t) => n + t.amount, 0);

const resolvedSum = (installments: Installment[]) =>
  installments
    .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
    .reduce((n, i) => n + i.amount, 0);

describe("vestlang_infer_schedule → vestlang_evaluate round-trip (context passthrough)", () => {
  // Family 1: a plain forward rate change. The inferrer segments it into
  // back-to-back equal-rate runs and writes them as a head + chained tails.
  it("recovers a rate-change stream as a THEN chain that evaluate accepts", async () => {
    const rateChange: Tranche[] = [
      { date: "2023-12-01", amount: 100 },
      { date: "2024-01-01", amount: 100 },
      { date: "2024-02-01", amount: 200 },
      { date: "2024-03-01", amount: 200 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
    ];
    const { dsl, evalSc } = await inferThenEvaluate(rateChange, "2023-12-01");
    expect(dsl).toContain("THEN");

    expect(evalSc.resolvesTo.status).toBe("template");
    // Every original tranche is reproduced — the round-trip is exact.
    expect(resolvedSum(evalSc.installments)).toBe(sumOf(rateChange));
    // The whole chain attributes to one breakdown entry.
    expect(evalSc.breakdown).toHaveLength(1);
  });

  // Family 2: a lead lump (300 = 3 × 100) that hands off to a slower tail. The
  // cliff family needs a uniform-amount tail (this one steps 100 → 50), so recovery
  // falls to the per-segment THEN family: a short first segment plus continuations —
  // one schedule (THEN), with the lead reading as a plain segment, not a CLIFF.
  it("recovers a lead-lump THEN tail that evaluate accepts", async () => {
    const leadLumpThenTail: Tranche[] = [
      { date: "2024-02-01", amount: 300 },
      { date: "2024-03-01", amount: 100 },
      { date: "2024-04-01", amount: 100 },
      { date: "2024-05-01", amount: 100 },
      { date: "2024-06-01", amount: 50 },
      { date: "2024-07-01", amount: 50 },
      { date: "2024-08-01", amount: 50 },
    ];
    const { dsl, evalSc } = await inferThenEvaluate(
      leadLumpThenTail,
      "2023-11-01",
    );
    expect(dsl).toContain("THEN");
    expect(dsl).not.toContain("CLIFF");

    expect(evalSc.resolvesTo.status).toBe("template");
    expect(resolvedSum(evalSc.installments)).toBe(sumOf(leadLumpThenTail));
    expect(evalSc.breakdown).toHaveLength(1);
  });

  // Family 3: a rate change whose handoff falls on a short month. The chain's grid
  // springs back to the month's last day; written as THEN the tail carries no start
  // of its own, so the clamp can't strand it off the running grid.
  //
  // The head (200 of 800 = 1/4) and tail (600 of 800 = 3/4) are terminating shares,
  // so the inferred THEN chain stores both percentages exactly and round-trips.
  it("recovers a month-end-clamped THEN chain that evaluate accepts", async () => {
    const monthEnd: Tranche[] = [
      { date: "2023-12-31", amount: 100 },
      { date: "2024-01-31", amount: 100 },
      { date: "2024-02-29", amount: 300 },
      { date: "2024-03-31", amount: 300 },
    ];
    const { dsl, evalSc } = await inferThenEvaluate(monthEnd, "2023-11-30");
    expect(dsl).toContain("THEN");

    expect(evalSc.resolvesTo.status).toBe("template");
    expect(resolvedSum(evalSc.installments)).toBe(sumOf(monthEnd));
  });
});
