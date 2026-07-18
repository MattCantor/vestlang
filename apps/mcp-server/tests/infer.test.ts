import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { evaluateStatement } from "@vestlang/evaluator";
import { parseToProgram } from "@vestlang/pipeline";
import { MAX_INSTALLMENTS } from "@vestlang/primitives";
import type {
  Installment,
  OCTDate,
  ResolvedInstallment,
} from "@vestlang/types";
import { createServer } from "../src/server.js";

// These tests exercise the MCP tool layer for `vestlang_infer_schedule` —
// {tranches, grant_date} argument parsing/validation, the success envelope, the
// evaluate-keyed context a consumer forwards to vestlang_evaluate, and the
// schema-error path. The inference *logic* (decomposition, round-trip fidelity) is
// owned and covered by @vestlang/inferrer; we do not re-test it here.

type CallResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

/** Connect an in-memory client to the real server so calls go through the
 * registered tool (Zod validation + handler + response shaping). */
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

function callInfer(
  client: Client,
  args: {
    tranches: { date: string; amount: number }[];
    grant_date?: string;
    grant_quantity?: number;
  },
): Promise<CallResult> {
  return client.callTool({
    name: "vestlang_infer_schedule",
    arguments: args,
  }) as Promise<CallResult>;
}

/** Build {date, amount} tranches by evaluating a known DSL statement. */
function tranchesFromDsl(
  dsl: string,
  grantDate: OCTDate,
  grantQuantity: number,
): { date: string; amount: number }[] {
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) throw new Error(`failed to parse fixture DSL: ${dsl}`);
  const installments: Installment[] = evaluateStatement(parsed.program[0], {
    grantDate,
    events: {},
    grantQuantity,
    vesting_day_of_month: "VESTING_START_DAY",
  }).resolvesTo.installments;
  return installments
    .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
    .map((i) => ({
      date: i.date,
      amount: i.amount,
    }));
}

describe("mcp-server / vestlang_infer_schedule tool layer", () => {
  it("returns the success envelope with text + structuredContent that agree", async () => {
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [
        { date: "2024-01-01", amount: 1000 },
        { date: "2024-02-01", amount: 1000 },
        { date: "2024-03-01", amount: 1000 },
      ],
    });

    expect(res.isError).toBeFalsy();
    expect(res.content[0].type).toBe("text");
    expect(res.structuredContent).toBeDefined();
    // The text content is the JSON serialization of structuredContent.
    expect(JSON.parse(res.content[0].text)).toEqual(res.structuredContent);

    const sc = res.structuredContent as Record<string, unknown>;
    expect(sc).toHaveProperty("dsl");
    expect(sc).toHaveProperty("decomposition");
    expect(sc).toHaveProperty("diagnostics");
    expect(typeof sc.dsl).toBe("string");
  });

  it("returns the evaluate-keyed context a consumer forwards to vestlang_evaluate", async () => {
    // The day-of-month is NOT encoded in the returned DSL; the tool hands back a
    // context keyed exactly as vestlang_evaluate's parameters so a consumer forwards
    // it straight through. The library's camelCase context must not leak alongside.
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [
        { date: "2024-01-01", amount: 500 },
        { date: "2024-02-01", amount: 500 },
      ],
    });

    const sc = res.structuredContent as { context: Record<string, unknown> };
    expect(sc.context).toEqual({
      grant_date: "2024-01-01",
      grant_quantity: 1000,
      vesting_day_of_month: "VESTING_START_DAY",
      events: {},
    });
    expect(sc.context).not.toHaveProperty("grantDate");
    expect(sc.context).not.toHaveProperty("grantQuantity");
  });

  // With grant_date supplied, the lump a year out is a cliff (a `cliff`-tagged
  // component); this asserts the {grant_date} arg is forwarded to inferSchedule as
  // grantDate.
  it("forwards grant_date so the cliff lump is read as a cliff", async () => {
    const client = await connectClient();
    const tranches = tranchesFromDsl(
      "48000 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 1 month CLIFF 12 months",
      "2024-01-01",
      48000,
    );

    const res = await callInfer(client, {
      tranches,
      grant_date: "2024-01-01",
    });

    const sc = res.structuredContent as {
      decomposition: { tag: string }[];
      diagnostics: { residualError: number };
    };
    expect(sc.diagnostics.residualError).toBeLessThan(1e-6);
    expect(sc.decomposition.some((c) => c.tag === "cliff")).toBe(true);
  });

  it("defaults grant_date to the first tranche date when omitted", async () => {
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [
        { date: "2024-01-01", amount: 1000 },
        { date: "2024-02-01", amount: 1000 },
        { date: "2024-03-01", amount: 1000 },
      ],
    });

    const notes = (
      res.structuredContent as { diagnostics: { notes: string[] } }
    ).diagnostics.notes;
    expect(notes.some((n) => n.includes("grantDate defaulted"))).toBe(true);
  });

  // An all-zero (but non-empty) input used to fall through to the generic
  // "could not infer" toolError; the inferrer-core guard now returns a degenerate
  // template, so the MCP seam surfaces a success envelope (#404).
  it("returns a degenerate template for an all-zero, non-empty input", async () => {
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [{ date: "2025-02-01", amount: 0 }],
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      dsl: string;
      diagnostics: { residualError: number };
      context: { grant_quantity: number };
    };
    expect(sc.dsl).toBe("0 VEST FROM DATE 2025-02-01");
    expect(sc.diagnostics.residualError).toBeLessThan(1e-6);
    expect(sc.context.grant_quantity).toBe(0);
  });

  it("passes through grant_quantity and surfaces diagnostics.coverage in camelCase", async () => {
    // The optional grant total rides straight into the library; the coverage tell
    // it produces flows back through the `diagnostics` spread unchanged — only
    // `context` is re-keyed to snake_case, never `diagnostics`.
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [
        { date: "2024-01-01", amount: 1000 },
        { date: "2024-02-01", amount: 1000 },
        { date: "2024-03-01", amount: 1000 },
      ],
      grant_quantity: 10000,
    });

    expect(res.isError).toBeFalsy();
    const sc = res.structuredContent as {
      diagnostics: {
        notes: string[];
        coverage?: {
          grantQuantity: number;
          trancheSum: number;
          delta: number;
          status: string;
        };
      };
    };
    expect(sc.diagnostics.coverage).toEqual({
      grantQuantity: 10000,
      trancheSum: 3000,
      delta: -7000,
      status: "partial",
    });
    expect(
      sc.diagnostics.notes.some((n) =>
        n.includes("vestlang_verify_observations"),
      ),
    ).toBe(true);
  });

  it("omits diagnostics.coverage when grant_quantity is not supplied", async () => {
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [
        { date: "2024-01-01", amount: 1000 },
        { date: "2024-02-01", amount: 1000 },
        { date: "2024-03-01", amount: 1000 },
      ],
    });

    const sc = res.structuredContent as {
      diagnostics: Record<string, unknown>;
    };
    expect(sc.diagnostics).not.toHaveProperty("coverage");
  });

  it("rejects a below-1 grant_quantity via the input schema", async () => {
    const client = await connectClient();
    for (const grant_quantity of [0, -5]) {
      const res = await callInfer(client, {
        tranches: [{ date: "2024-01-01", amount: 1000 }],
        grant_quantity,
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("at least 1");
    }
  });

  it("rejects a non-integer grant_quantity via the input schema", async () => {
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [{ date: "2024-01-01", amount: 1000 }],
      grant_quantity: 3.5,
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("whole number");
  });

  it("rejects an empty tranches array via the input schema", async () => {
    const client = await connectClient();
    const res = await callInfer(client, { tranches: [] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("at least one entry");
  });

  it("rejects an over-cap tranches array via the input schema, naming the limit", async () => {
    const client = await connectClient();
    const tranches = Array.from({ length: MAX_INSTALLMENTS + 1 }, () => ({
      date: "2024-01-01",
      amount: 1,
    }));
    const res = await callInfer(client, { tranches });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(String(MAX_INSTALLMENTS));
  });

  it("rejects a malformed date via the input schema", async () => {
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [{ date: "01/01/2024", amount: 5 }],
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("YYYY-MM-DD");
  });

  // The input schema is the first line of defense: it must reject out-of-domain
  // amounts before they descend into the engine, and the error must never name
  // an internal type (#74 item 1).
  it.each([
    ["a fractional amount", 31.25],
    ["a negative amount", -10],
  ])("rejects %s without leaking internal type names", async (_label, bad) => {
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [
        { date: "2025-01-01", amount: bad },
        { date: "2025-02-01", amount: 20 },
      ],
    });
    expect(res.isError).toBe(true);
    const text = res.content[0].text;
    expect(text).not.toMatch(
      /totalShares|VestingScheduleTemplate|VestingRuntime|BigInt/,
    );
  });
});
