import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

// The ISO_DATE zod schema gates every date argument the server accepts. A
// calendar refine on it means a lexically-shaped-but-impossible date is rejected
// once, consistently, instead of rolling over / throwing / returning null per
// tool. We spot-check a few tools through the real registered-tool path.

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

describe("mcp-server / calendar-date validation at the tool boundary", () => {
  it("rejects an impossible date passed to add_period", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_add_period", {
      date: "2025-02-31",
      length: 1,
      unit: "months",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/calendar date/i);
  });

  it("rejects an out-of-range month in date_diff", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_date_diff", {
      from: "2023-13-01",
      to: "2024-01-01",
      unit: "days",
    });
    expect(res.isError).toBe(true);
  });

  it("rejects an impossible date in resolve_vesting_day", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_resolve_vesting_day", {
      date: "2026-02-30",
      rule: "15",
    });
    expect(res.isError).toBe(true);
  });

  it("still accepts a real date (leap day) through add_period", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_add_period", {
      date: "2024-02-29",
      length: 1,
      unit: "years",
    });
    expect(res.isError).toBeFalsy();
  });

  // A day count large enough to overflow Date's internal range once produced a
  // "0NaN-NaN-NaN" string instead of erroring. The range guard now catches it
  // before formatting, so the tool returns the clean out-of-range error.
  it("returns a clean range error for a huge day offset in add_period", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_add_period", {
      date: "2025-01-01",
      length: 300_000_000,
      unit: "days",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/representable range/i);
    expect(res.content[0].text).not.toMatch(/NaN/);
  });

  // The same overflow reached through resolve_offset used to leak an internal
  // runtime-validation message. It now surfaces the same clean range error,
  // not the constructor's complaint about a malformed startDate.
  it("returns a clean range error for a huge day offset in resolve_offset", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_resolve_offset", {
      expr: "+ 100000000 days",
      grant_date: "2025-01-01",
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/representable range/i);
    expect(res.content[0].text).not.toMatch(/VestingRuntime/);
    expect(res.content[0].text).not.toMatch(/NaN/);
  });
});
