import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// #442: the per-clause `breakdown` is a partition of the one headline allocation,
// so its amounts sum to the headline by construction — the old
// `breakdownResidual`/`breakdownNote` markers are gone (post-unification the
// residual is always 0). The pipeline owns the arithmetic
// (packages/pipeline/tests/run.spec.ts); here we only check the tool layer passes
// the breakdown through with no marker, and the description no longer names them.

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

async function evaluate(args: {
  dsl: string;
  grant_date: string;
  grant_quantity: number;
}): Promise<Record<string, unknown>> {
  const client = await connectClient();
  const res = (await client.callTool({
    name: "vestlang_evaluate",
    arguments: args,
  })) as CallResult;
  expect(res.isError).toBeFalsy();
  return res.structuredContent as Record<string, unknown>;
}

const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + x.amount, 0);
const sumBreakdown = (b: { installments: { amount: number }[] }[]) =>
  b.reduce((a, c) => a + sum(c.installments), 0);

describe("mcp-server / breakdown sums to headline (#442)", () => {
  it("the non-divisible 1/3 PLUS 1/3 PLUS 1/3 breakdown ties the headline", async () => {
    const sc = await evaluate({
      dsl:
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 100,
    });
    const installments = sc.installments as { amount: number }[];
    const breakdown = sc.breakdown as { installments: { amount: number }[] }[];
    expect(sum(installments)).toBe(100);
    expect(sumBreakdown(breakdown)).toBe(100);
    // The markers no longer ride along.
    expect("breakdownResidual" in sc).toBe(false);
    expect("breakdownNote" in sc).toBe(false);
  });

  it("the breakdown ties even on a valid:false over-allocation", async () => {
    const sc = await evaluate({
      dsl:
        "2/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "2/3 VEST OVER 1 month EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 100,
    });
    const installments = sc.installments as { amount: number }[];
    const breakdown = sc.breakdown as { installments: { amount: number }[] }[];
    expect(sc.valid).toBe(false);
    expect(sumBreakdown(breakdown)).toBe(sum(installments));
    expect("breakdownResidual" in sc).toBe(false);
  });
});

describe("mcp-server / vestlang_evaluate description drops the residual fields (#442)", () => {
  it("no longer references breakdownResidual or breakdownNote", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const description =
      tools.find((t) => t.name === "vestlang_evaluate")?.description ?? "";
    expect(description).not.toContain("breakdownResidual");
    expect(description).not.toContain("breakdownNote");
    expect(description).toContain("sum to the headline by construction");
  });
});
