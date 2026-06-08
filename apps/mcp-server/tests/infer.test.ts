import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { evaluateStatement } from "@vestlang/evaluator";
import { parseToProgram } from "@vestlang/pipeline";
import type {
  Installment,
  OCTDate,
  ResolvedInstallment,
} from "@vestlang/types";
import { createServer } from "../src/server.js";

// These tests exercise the MCP tool layer for `vestlang_infer_schedule` —
// {tranches, grant_date} argument parsing/validation, the success envelope, the
// diagnostics passthrough consumers must feed back, and the schema-error path.
// The inference *logic* (decomposition, round-trip fidelity) is owned and
// covered by @vestlang/inferrer; we do not re-test it here.

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
  asOf: OCTDate,
): { date: string; amount: number }[] {
  const parsed = parseToProgram(dsl);
  if (!parsed.ok) throw new Error(`failed to parse fixture DSL: ${dsl}`);
  const installments: Installment[] = evaluateStatement(parsed.program[0], {
    events: { grantDate },
    grantQuantity,
    asOf,
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
  }).installments;
  return installments
    .filter((i): i is ResolvedInstallment => i.meta.state === "RESOLVED")
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

  it("surfaces the diagnostics passthrough consumers must feed back", async () => {
    // Per the tool docs, vestingDayOfMonth is NOT encoded in the returned DSL;
    // callers must pass it back as EvaluationContext. The tool layer must
    // therefore expose it in the response.
    const client = await connectClient();
    const res = await callInfer(client, {
      tranches: [
        { date: "2024-01-01", amount: 500 },
        { date: "2024-02-01", amount: 500 },
      ],
    });

    const diagnostics = (res.structuredContent as { diagnostics: unknown })
      .diagnostics as {
      vestingDayOfMonth: unknown;
    };
    expect(diagnostics.vestingDayOfMonth).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });

  // With grant_date supplied, the lump a year out is a cliff (cliffFolds=1); this
  // asserts the {grant_date} arg is forwarded to inferSchedule as grantDate.
  it("forwards grant_date so the cliff lump is read as a cliff", async () => {
    const client = await connectClient();
    const tranches = tranchesFromDsl(
      "48000 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 1 month CLIFF 12 months",
      "2024-01-01",
      48000,
      "2028-02-01",
    );

    const res = await callInfer(client, {
      tranches,
      grant_date: "2024-01-01",
    });

    const sc = res.structuredContent as {
      decomposition: { cliffFolds: number };
      diagnostics: { residualError: number };
    };
    expect(sc.diagnostics.residualError).toBeLessThan(1e-6);
    expect(sc.decomposition.cliffFolds).toBe(1);
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

  it("rejects an empty tranches array via the input schema", async () => {
    const client = await connectClient();
    const res = await callInfer(client, { tranches: [] });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("at least one entry");
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
