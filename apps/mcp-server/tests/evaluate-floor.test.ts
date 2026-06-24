import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// #447 — the cliff `floor` on a held `UNRESOLVED_CLIFF` installment must survive
// the end-to-end MCP path: `vestlang_evaluate` returns `...result.view`, and the
// view hands `s.resolution.installments` through verbatim (pipeline/view.ts). No
// code in the tool transforms it, so this is a pure passthrough — exactly the kind
// a future view reshape or field-whitelist could silently drop. These tests pin
// that the field reaches `structuredContent.installments[0].symbolicDate.floor`.

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

// The shape we read off the wire — only the bits this test asserts on.
type Installment = {
  state: string;
  symbolicDate?: { type: string; date: string; floor?: string };
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

const evaluate = async (
  client: Client,
  dsl: string,
): Promise<Installment[]> => {
  const res = (await client.callTool({
    name: "vestlang_evaluate",
    arguments: { dsl, grant_date: "2025-01-01", grant_quantity: 4800 },
  })) as CallResult;
  expect(res.isError).toBeFalsy();
  return (res.structuredContent as { installments: Installment[] })
    .installments;
};

describe("#447 — cliff floor rides the vestlang_evaluate passthrough", () => {
  it("discloses the floor on a held LATER OF cliff (ipo unfired)", async () => {
    const client = await connectClient();
    const installments = await evaluate(
      client,
      "VEST FROM grantDate OVER 48 months EVERY 1 month " +
        "CLIFF LATER OF(vestingStart + 12 months, EVENT ipo)",
    );

    const first = installments[0];
    expect(first.state).toBe("UNRESOLVED");
    expect(first.symbolicDate).toEqual({
      type: "UNRESOLVED_CLIFF",
      date: "2025-02-01",
      floor: "2026-01-01",
    });
    // Every held tranche carries the same resolved +12mo floor.
    expect(
      installments.every((i) => i.symbolicDate?.floor === "2026-01-01"),
    ).toBe(true);
  });

  it("omits the floor on a held bare CLIFF EVENT (no time arm)", async () => {
    const client = await connectClient();
    const installments = await evaluate(
      client,
      "VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF EVENT board",
    );

    const first = installments[0];
    expect(first.state).toBe("UNRESOLVED");
    expect(first.symbolicDate?.type).toBe("UNRESOLVED_CLIFF");
    // No time arm → no known floor → the key is absent (not floor: undefined).
    expect(
      installments.every(
        (i) => i.symbolicDate !== undefined && !("floor" in i.symbolicDate),
      ),
    ).toBe(true);
  });
});
