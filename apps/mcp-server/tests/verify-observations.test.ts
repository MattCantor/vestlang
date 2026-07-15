import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// The vestlang_verify_observations tool: registration, the shared wire envelope,
// its structured result plus human summary, and the input-schema guards that keep
// bad input on the isError channel (a positive-integer grant quantity, at least one
// observation, a balance figure present).

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
    name: "vestlang_verify_observations",
    arguments: args,
  }) as Promise<CallResult>;

const sc = (res: CallResult) =>
  res.structuredContent as Record<string, unknown>;

const GRANT = { grant_date: "2025-01-01", grant_quantity: 1200 };
const MONTHLY = "VEST OVER 12 months EVERY 1 month";

describe("vestlang_verify_observations — registration", () => {
  it("is registered with read-only annotations", async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "vestlang_verify_observations");
    expect(tool).toBeDefined();
    expect(tool!.annotations?.readOnlyHint).toBe(true);
    expect(tool!.annotations?.openWorldHint).toBe(false);
  });
});

describe("vestlang_verify_observations — result envelope", () => {
  it("wraps a graded result in { ok: true } with the facts and a human summary", async () => {
    const client = await connectClient();
    const res = await call(client, {
      dsl: MONTHLY,
      ...GRANT,
      observations: [
        { kind: "balance", date: "2025-06-01", vested: 500 },
        { kind: "tranche", date: "2025-02-01", amount: 100 },
      ],
    });
    expect(res.isError).toBeFalsy();
    const out = sc(res);
    expect(out.ok).toBe(true);
    expect(out.matches).toBe(true);
    expect(Array.isArray(out.rows)).toBe(true);
    expect(typeof out.worstGap).toBe("number");
    expect(typeof out.summary).toBe("string");
    expect(out.summary as string).toMatch(/within tolerance/);
  });

  it("reports a mismatch's summary from the structured facts", async () => {
    const client = await connectClient();
    const res = await call(client, {
      dsl: MONTHLY,
      ...GRANT,
      observations: [{ kind: "tranche", date: "2025-02-15", amount: 100 }],
    });
    const out = sc(res);
    expect(out.matches).toBe(false);
    expect(out.summary as string).toMatch(/outside tolerance/);
  });

  it("surfaces a verify refusal as { ok: false } data, not an isError exception", async () => {
    const client = await connectClient();
    const res = await call(client, {
      dsl:
        "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month PLUS " +
        "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month",
      ...GRANT,
      observations: [{ kind: "balance", date: "2026-01-01", vested: 1000 }],
    });
    expect(res.isError).toBeFalsy();
    const out = sc(res);
    expect(out.ok).toBe(false);
    expect((out.error as { ruleId: string }).ruleId).toBe(
      "verify-over-allocation",
    );
  });
});

describe("vestlang_verify_observations — input validation stays on the isError channel", () => {
  it("rejects a grant_quantity below one (the percent-of-grant denominator)", async () => {
    const client = await connectClient();
    const res = await call(client, {
      dsl: MONTHLY,
      grant_date: "2025-01-01",
      grant_quantity: 0,
      observations: [{ kind: "balance", date: "2025-06-01", vested: 0 }],
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
  });

  it("rejects an empty observations array", async () => {
    const client = await connectClient();
    const res = await call(client, {
      dsl: MONTHLY,
      ...GRANT,
      observations: [],
    });
    expect(res.isError).toBe(true);
  });

  it("rejects a balance observation with neither vested nor unvested", async () => {
    const client = await connectClient();
    const res = await call(client, {
      dsl: MONTHLY,
      ...GRANT,
      observations: [{ kind: "balance", date: "2025-06-01" }],
    });
    expect(res.isError).toBe(true);
  });

  it("rejects a non-ISO observation date", async () => {
    const client = await connectClient();
    const res = await call(client, {
      dsl: MONTHLY,
      ...GRANT,
      observations: [{ kind: "tranche", date: "June 1", amount: 100 }],
    });
    expect(res.isError).toBe(true);
  });
});

describe("vestlang_verify_observations — description and instructions", () => {
  async function descriptionOf(toolName: string): Promise<string> {
    const client = await connectClient();
    const { tools } = await client.listTools();
    return tools.find((t) => t.name === toolName)?.description ?? "";
  }

  it("the description explains percent-of-grant gaps and the no-score stance", async () => {
    const description = await descriptionOf("vestlang_verify_observations");
    expect(description).toMatch(/percent of the grant/i);
    expect(description).toMatch(/no composite score/i);
    expect(description).toContain("nearest");
  });

  it("the server instructions name the verification workflow and tool family", async () => {
    const client = await connectClient();
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("vestlang_verify_observations");
    expect(instructions).toMatch(/parse, compile, evaluate, verify, lint/);
  });
});
