import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Checks that evaluate_program surfaces the absence assumptions a closed-world
// reading leaned on — the events it took to still be unfired, and by when. The
// derivation itself is covered in @vestlang/evaluator; here we only confirm the
// tool layer passes the list through (with its rendered message).

type CallResult = {
  isError?: boolean;
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

type Absence = { eventId: string; through: string; message: string };

describe("mcp-server / absence-assumption surfacing", () => {
  it("evaluate_program discloses a gated start's assumed-absent event", async () => {
    const client = await connectClient();
    // Vest from a fixed date, on the understanding it lands before ipo — pending
    // while ipo is unfired, so the reading assumes ipo absent through that date.
    const res = (await client.callTool({
      name: "vestlang_evaluate_program",
      arguments: {
        dsl: "VEST FROM DATE 2025-01-01 BEFORE EVENT ipo OVER 48 months EVERY 1 month",
        grant_date: "2025-01-01",
        grant_quantity: 1000,
      },
    })) as CallResult;

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as { absenceAssumptions: Absence[] };
    expect(sc.absenceAssumptions).toHaveLength(1);
    expect(sc.absenceAssumptions[0].eventId).toBe("ipo");
    expect(sc.absenceAssumptions[0].through).toBe("2025-01-01");
    expect(sc.absenceAssumptions[0].message).toContain("ipo");
  });

  it("a plain date program discloses no absence assumptions", async () => {
    const client = await connectClient();
    const res = (await client.callTool({
      name: "vestlang_evaluate_program",
      arguments: {
        dsl: "VEST FROM DATE 2025-01-01 OVER 1 year EVERY 1 year",
        grant_date: "2025-01-01",
        grant_quantity: 1000,
      },
    })) as CallResult;

    const sc = res.structuredContent as { absenceAssumptions: Absence[] };
    expect(sc.absenceAssumptions).toEqual([]);
  });
});
