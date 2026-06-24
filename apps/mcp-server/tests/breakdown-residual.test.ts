import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// #401: the evaluate handler carries the breakdown↔headline rounding residual
// in-band — `breakdownResidual` (a number) plus a fixed `breakdownNote` — so a
// consumer reading only the JSON learns there's a gap and which figure is
// authoritative, without consulting the tool description. The pipeline owns the
// arithmetic (packages/pipeline/tests/run.spec.ts); here we only check the tool
// layer passes the fields through and the description names them.

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

describe("mcp-server / breakdown residual passthrough (#401)", () => {
  it("surfaces a positive residual and an in-band note", async () => {
    // 1/3 + 1/3 + 1/3 of 100 floors per clause to 99 against a headline of 100.
    const sc = await evaluate({
      dsl:
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 100,
    });
    expect(sc.breakdownResidual).toBe(1);
    expect(typeof sc.breakdownNote).toBe("string");
    // The note carries the authoritative figure without the tool description.
    expect(sc.breakdownNote as string).toMatch(/collapsed schedule/i);
  });

  it("surfaces a 0 residual when the breakdown ties the headline", async () => {
    const sc = await evaluate({
      dsl:
        "0.5 VEST OVER 1 month EVERY 1 month PLUS " +
        "0.5 VEST OVER 1 month EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 100,
    });
    expect(sc.breakdownResidual).toBe(0);
    expect(typeof sc.breakdownNote).toBe("string");
  });

  it("computes the residual verbatim on a valid:false over-allocation", async () => {
    // 2/3 + 2/3 of 100 = 4/3: headline 133 (66+67), breakdown 132 (66+66).
    const sc = await evaluate({
      dsl:
        "2/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "2/3 VEST OVER 1 month EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 100,
    });
    expect(sc.valid).toBe(false);
    expect(sc.breakdownResidual).toBe(1);
  });
});

describe("mcp-server / vestlang_evaluate description names the residual fields (#401)", () => {
  it("references breakdownResidual and breakdownNote", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const description =
      tools.find((t) => t.name === "vestlang_evaluate")?.description ?? "";
    expect(description).toContain("breakdownResidual");
    expect(description).toContain("breakdownNote");
  });
});
