import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

// R2-B23: grant_quantity is gated for safe-integer range at the zod boundary,
// so an unrepresentable share count is refused as input validation and never
// reaches the engine (whose own guards would throw a deeper, kernel-flavored
// message).

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

describe("mcp-server / grant_quantity safe-integer validation", () => {
  it("rejects a grant_quantity past Number.MAX_SAFE_INTEGER", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_evaluate", {
      dsl: "VEST OVER 12 months EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 2 ** 53,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/safe integer range/);
  });

  it("accepts the largest safe grant_quantity", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_evaluate", {
      dsl: "VEST OVER 12 months EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: Number.MAX_SAFE_INTEGER,
    });
    expect(res.isError).not.toBe(true);
  });
});
