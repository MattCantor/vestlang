import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Exercises the MCP tool layer for `vestlang_evaluate_program` once the recovery
// pass is wired in: the rescued response shape (`recovered` block) and its
// absence when nothing is recovered. The recovery *logic* lives in and is covered
// by @vestlang/recover; here we only check the tool surfaces it.

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

function callEval(
  client: Client,
  args: { dsl: string; grant_date: string; grant_quantity: number },
): Promise<CallResult> {
  return client.callTool({
    name: "vestlang_evaluate_program",
    arguments: args,
  }) as Promise<CallResult>;
}

describe("mcp-server / vestlang_evaluate_program recovery", () => {
  // The #43 case: two overlapping absolute-date grids classify events-only, but
  // their projection has an equivalent single THEN-chain template.
  it("emits status=template + a recovered block when a rescue happens", async () => {
    const client = await connectClient();
    const res = await callEval(client, {
      dsl: "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-03-01 OVER 4 months EVERY 1 month",
      grant_date: "2024-01-01",
      grant_quantity: 800,
    });

    expect(res.isError).toBeFalsy();
    // Text content is the JSON serialization of structuredContent.
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);

    const sc = res.structuredContent as {
      status: string;
      reason?: string;
      recovered?: {
        from: string;
        reason: string;
        dsl: string;
        vestingDayOfMonth: string;
        residualError: number;
      };
    };
    expect(sc.status).toBe("template");
    // The events-only reason moves into the recovered block, not the top level.
    expect(sc.reason).toBeUndefined();
    expect(sc.recovered).toBeDefined();
    expect(sc.recovered?.from).toBe("events-only");
    expect(sc.recovered?.reason).toBe(
      "Two independent absolute-date vesting grids on one grant.",
    );
    expect(sc.recovered?.dsl).toContain("THEN");
    expect(sc.recovered?.residualError).toBe(0);
    expect(sc.recovered?.vestingDayOfMonth).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });

  // Two grids on different days of the month interleave with no single-template
  // form — genuinely events-only, so no recovery.
  it("leaves a genuinely events-only program untouched (no recovered block)", async () => {
    const client = await connectClient();
    const res = await callEval(client, {
      dsl: "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS 0.5 VEST FROM DATE 2024-01-15 OVER 4 months EVERY 1 month",
      grant_date: "2024-01-01",
      grant_quantity: 800,
    });

    const sc = res.structuredContent as {
      status: string;
      reason?: string;
      recovered?: unknown;
    };
    expect(sc.status).toBe("events-only");
    expect(sc.reason).toBeDefined();
    expect(sc.recovered).toBeUndefined();
  });

  it("adds no recovered block to a program that was already a template", async () => {
    const client = await connectClient();
    const res = await callEval(client, {
      dsl: "400 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month",
      grant_date: "2024-01-01",
      grant_quantity: 400,
    });

    const sc = res.structuredContent as { status: string; recovered?: unknown };
    expect(sc.status).toBe("template");
    expect(sc.recovered).toBeUndefined();
  });
});
