import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MAX_EVENTS } from "@vestlang/primitives";
import { createServer } from "../src/server.js";

// Every tool that accepts an events record caps it at the zod boundary, so an
// over-cap record is rejected during input parsing (isError: true) before any
// domain logic runs. A record exactly at the cap is accepted.

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

const call = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<CallResult>;

const eventsOfSize = (n: number): Record<string, string> =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`e${i}`, "2024-01-01"]),
  );

const overCap = () => eventsOfSize(MAX_EVENTS + 1);
const atCap = () => eventsOfSize(MAX_EVENTS);

// "1000 entries", not a bare "1000": the number alone is a substring of the
// installment cap (10000), so the assertion names the events-cap wording.
const CAP_TEXT = new RegExp(`${MAX_EVENTS}\\s*entries`, "i");

const expectCapRejection = (res: CallResult) => {
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(CAP_TEXT);
};

const SCHEDULE = "VEST FROM DATE 2025-01-01 OVER 4 months EVERY 1 month";

// A valid persisted artifact, so a rehydrate rejection can only be the events cap.
async function persistArtifact(client: Client): Promise<unknown> {
  const res = await call(client, "vestlang_persist", {
    dsl: SCHEDULE,
    grant_date: "2025-01-01",
    grant_quantity: 1000,
  });
  return (res.structuredContent as { artifact: unknown }).artifact;
}

describe("mcp-server / events-record cap at the tool boundary", () => {
  it("vestlang_evaluate rejects an over-cap events record", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_evaluate", {
      dsl: SCHEDULE,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      events: overCap(),
    });
    expectCapRejection(res);
  });

  it("vestlang_evaluate_as_of rejects an over-cap events record", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_evaluate_as_of", {
      dsl: SCHEDULE,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      events: overCap(),
    });
    expectCapRejection(res);
  });

  it("vestlang_vested_between rejects an over-cap events record", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_vested_between", {
      dsl: SCHEDULE,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      from: "2025-01-01",
      to: "2025-12-31",
      events: overCap(),
    });
    expectCapRejection(res);
  });

  it("vestlang_persist rejects an over-cap events record", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_persist", {
      dsl: SCHEDULE,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      events: overCap(),
    });
    expectCapRejection(res);
  });

  it("vestlang_resolve_offset rejects an over-cap events record", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_resolve_offset", {
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
      events: overCap(),
    });
    expectCapRejection(res);
  });

  it("vestlang_rehydrate rejects an over-cap events record (with a valid artifact)", async () => {
    const client = await connectClient();
    const artifact = await persistArtifact(client);
    const res = await call(client, "vestlang_rehydrate", {
      artifact,
      grant_quantity: 1000,
      events: overCap(),
    });
    expectCapRejection(res);
  });

  it("vestlang_evaluate accepts an events record exactly at the cap", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_evaluate", {
      dsl: SCHEDULE,
      grant_date: "2025-01-01",
      grant_quantity: 1000,
      events: atCap(),
    });
    expect(res.isError).toBeFalsy();
  });
});
