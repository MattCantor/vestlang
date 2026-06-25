import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

// vestlang_resolve_offset's handler does `jsonResult(result)`, so the structured
// result rides the wire whole, `ok` discriminant and all. Under #345 this is now
// the reference shape every tool emits — the evaluate family and persist/rehydrate
// were brought into line with it. These pins lock offset's full failure and
// success shapes.

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

const call = (client: Client, args: Record<string, unknown>) =>
  client.callTool({
    name: "vestlang_resolve_offset",
    arguments: args,
  }) as Promise<CallResult>;

describe("mcp-server / vestlang_resolve_offset wire shape (AC#6)", () => {
  it("an unresolved expression returns { ok: false, error: { ruleId, message, unresolved } }", async () => {
    const client = await connectClient();
    const res = await call(client, {
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
    });

    // Not surfaced as an MCP isError — the structured result is the payload.
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      ok: false,
      error: {
        ruleId: "offset-unresolved",
        message: "Expression is unresolved: EVENT ipo",
        unresolved: "EVENT ipo",
      },
    });
  });

  it("a parse failure returns { ok: false, error: { ruleId, message } } with no loc", async () => {
    const client = await connectClient();
    const res = await call(client, {
      expr: "this is not vestlang",
      grant_date: "2025-01-01",
    });
    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      ok: boolean;
      error: { ruleId: string; message: string; loc?: unknown };
    };
    expect(sc.ok).toBe(false);
    expect(sc.error.ruleId).toBe("syntax-error");
    expect(sc.error.message).toMatch(/^Could not parse expression: /);
    // The rewrap drops the synthetic-wrap span.
    expect(sc.error).not.toHaveProperty("loc");
  });

  it("the success path is exactly { ok: true, date } (unchanged)", async () => {
    const client = await connectClient();
    const res = await call(client, {
      expr: "DATE 2025-01-01 + 6 months",
      grant_date: "2025-01-01",
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ ok: true, date: "2025-07-01" });
  });

  // #325 — AC#2. A committed EARLIER OF (date arm resolved, event arm unfired) puts
  // the date AND the absence disclosure on structuredContent, message and all, so
  // an MCP caller sees that the answer assumes `ipo` stayed absent through the date.
  it("a committed EARLIER OF carries the absence disclosure on structuredContent", async () => {
    const client = await connectClient();
    const res = await call(client, {
      expr: "EARLIER OF (DATE 2024-06-01, EVENT ipo)",
      grant_date: "2024-01-01",
      // ipo intentionally unfired.
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      ok: true,
      date: "2024-06-01",
      absenceAssumptions: [
        {
          eventId: "ipo",
          through: "2024-06-01",
          direction: "before",
          inclusive: false,
          consequence: "grid-shift",
          message:
            "ipo did not occur before 2024-06-01 — a contradicting firing would shift the schedule",
        },
      ],
    });
  });
});
