import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CONTINGENT_START_SENTINEL } from "@vestlang/utils";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Issue #345 — the MCP wire envelope is unified across all 14 tools onto an
// explicit `ok` discriminant: success → { ok: true, ...payload }, structured
// refusal → { ok: false, error: { ruleId, ... } }. A genuine exception stays on
// MCP's separate `isError` channel. These tests crystallize the acceptance
// criteria: AC#1 (uniform success envelope), AC#2 (uniform refusal envelope with
// ruleId on the wire), AC#3 (sub-fields preserved), AC#4 (exceptions stay
// isError), AC#5 (lint envelope vs. domain rename), AC#6 (message bytes frozen).

type CallResult = {
  isError?: boolean;
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
};

type StructuredContent = {
  ok?: boolean;
  error?: { ruleId?: string; message?: string; [k: string]: unknown };
  [k: string]: unknown;
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

const sc = (res: CallResult) => res.structuredContent as StructuredContent;

// A storable bare-event artifact, persisted once, so rehydrate tests have a real
// artifact to start from (and AC#1 drives rehydrate with it).
async function persistBareEvent(client: Client): Promise<unknown> {
  const res = await call(client, "vestlang_persist", {
    dsl: "VEST FROM EVENT ipo OVER 4 months EVERY 1 month CLIFF +2 months",
    grant_date: "2025-01-01",
    grant_quantity: 400,
  });
  expect(res.isError).toBeFalsy();
  return (sc(res) as { artifact: unknown }).artifact;
}

const GRANT = { grant_date: "2025-01-01", grant_quantity: 1000 };

// Mirrors the helper in persist.test.ts: a hand-built contingent-start artifact —
// DATE-base on the contingent-start sentinel — whose sidecar maps `eventId` to a
// start recipe. With `eventId` the reserved `evt:start` key, rehydrate reparses the
// recipe; with a stray key, the namespace guard turns it away first. An extra valid
// `evt:start` recipe is always present so a stray key is what trips the guard.
const corruptArtifact = (eventId: string, definition: string) => ({
  template: {
    object_type: "VESTING_TERMS",
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
      },
    ],
  },
  runtime: { grantDate: "2025-01-01", startDate: CONTINGENT_START_SENTINEL },
  sidecar: {
    vestlang: {
      "evt:start": { definition: "EVENT ipo" },
      [eventId]: { definition },
    },
  },
});

/* ====================================================================
 * AC#1 — uniform success envelope across all 14 tools.
 * ==================================================================== */

describe("#345 AC#1 — every tool returns { ok: true } and a falsy isError on valid input", () => {
  it("the pure / DSL / evaluate tools", async () => {
    const client = await connectClient();
    const validDsl = "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month";

    const cases: Array<[string, Record<string, unknown>]> = [
      ["vestlang_parse", { dsl: validDsl }],
      ["vestlang_compile", { dsl: validDsl }],
      ["vestlang_evaluate", { dsl: validDsl, ...GRANT }],
      [
        "vestlang_evaluate_as_of",
        { dsl: validDsl, ...GRANT, as_of: "2026-01-01" },
      ],
      [
        "vestlang_vested_between",
        { dsl: validDsl, ...GRANT, from: "2025-01-01", to: "2025-12-31" },
      ],
      ["vestlang_lint", { dsl: validDsl }],
      [
        "vestlang_add_period",
        { date: "2025-01-01", length: 6, unit: "months" },
      ],
      [
        "vestlang_date_diff",
        { from: "2025-01-01", to: "2025-06-01", unit: "days" },
      ],
      [
        "vestlang_resolve_offset",
        { expr: "DATE 2025-01-01 + 6 months", grant_date: "2025-01-01" },
      ],
      [
        "vestlang_resolve_vesting_day",
        { date: "2026-02-15", rule: "LAST_DAY_OF_MONTH" },
      ],
    ];

    for (const [name, args] of cases) {
      const res = await call(client, name, args);
      expect(res.isError, `${name} should not be isError`).toBeFalsy();
      expect(sc(res).ok, `${name} should be ok: true`).toBe(true);
    }
  });

  it("stringify and infer_schedule (exception-channel tools, success arm)", async () => {
    const client = await connectClient();

    // Round-trip a compiled program back through stringify.
    const compiled = await call(client, "vestlang_compile", {
      dsl: "VEST OVER 48 months EVERY 1 month",
    });
    const program = (sc(compiled) as { program: unknown }).program;
    const stringified = await call(client, "vestlang_stringify", {
      ast: program,
    });
    expect(stringified.isError).toBeFalsy();
    expect(sc(stringified).ok).toBe(true);

    const inferred = await call(client, "vestlang_infer_schedule", {
      tranches: [
        { date: "2024-01-01", amount: 1000 },
        { date: "2024-02-01", amount: 1000 },
        { date: "2024-03-01", amount: 1000 },
      ],
    });
    expect(inferred.isError).toBeFalsy();
    expect(sc(inferred).ok).toBe(true);
  });

  it("persist and rehydrate", async () => {
    const client = await connectClient();
    const persisted = await call(client, "vestlang_persist", {
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month",
      ...GRANT,
    });
    expect(persisted.isError).toBeFalsy();
    expect(sc(persisted).ok).toBe(true);

    const artifact = (sc(persisted) as { artifact: unknown }).artifact;
    const rehydrated = await call(client, "vestlang_rehydrate", {
      artifact,
      grant_quantity: 1000,
    });
    expect(rehydrated.isError).toBeFalsy();
    expect(sc(rehydrated).ok).toBe(true);
  });
});

/* ====================================================================
 * AC#2 — uniform refusal envelope with the right ruleId on the wire.
 * ==================================================================== */

describe("#345 AC#2 — each refusal-capable tool surfaces { ok: false, error: { ruleId } }", () => {
  it("parse / compile refuse malformed DSL with syntax-error", async () => {
    const client = await connectClient();
    for (const name of ["vestlang_parse", "vestlang_compile"]) {
      const res = await call(client, name, { dsl: "this is not vestlang" });
      expect(res.isError, `${name}`).toBeFalsy();
      expect(sc(res).ok).toBe(false);
      expect(sc(res).error?.ruleId).toBe("syntax-error");
    }
  });

  it("vested_between refuses a from>to window with evaluation-error", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_vested_between", {
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month",
      ...GRANT,
      from: "2025-12-31",
      to: "2025-01-01",
    });
    expect(res.isError).toBeFalsy();
    expect(sc(res).ok).toBe(false);
    expect(sc(res).error?.ruleId).toBe("evaluation-error");
  });

  it("evaluate / evaluate_as_of refuse an over-cap schedule with evaluation-error", async () => {
    const client = await connectClient();
    for (const name of ["vestlang_evaluate", "vestlang_evaluate_as_of"]) {
      const res = await call(client, name, {
        dsl: "VEST OVER 1000000 months EVERY 1 month",
        ...GRANT,
      });
      expect(res.isError, name).toBeFalsy();
      expect(sc(res).ok, name).toBe(false);
      expect(sc(res).error?.ruleId, name).toBe("evaluation-error");
    }
  });

  it("evaluate / evaluate_as_of refuse malformed DSL with syntax-error", async () => {
    const client = await connectClient();
    for (const name of ["vestlang_evaluate", "vestlang_evaluate_as_of"]) {
      const res = await call(client, name, {
        dsl: "this is not vestlang",
        ...GRANT,
      });
      expect(res.isError, name).toBeFalsy();
      expect(sc(res).ok, name).toBe(false);
      expect(sc(res).error?.ruleId, name).toBe("syntax-error");
    }
  });

  it("persist refuses a non-template program with persist-not-storable (now on the wire)", async () => {
    const client = await connectClient();
    // Two independent date grids can't be one canonical template (events-only).
    const res = await call(client, "vestlang_persist", {
      dsl:
        "1/2 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months " +
        "PLUS 1/2 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months",
      ...GRANT,
    });
    expect(res.isError).toBeFalsy();
    expect(sc(res).ok).toBe(false);
    expect(sc(res).error?.ruleId).toBe("persist-not-storable");
  });

  it("resolve_offset refuses a multi-statement expr with offset-not-single-expression", async () => {
    const client = await connectClient();
    // A PLUS fan-out wraps to `VEST FROM <a> PLUS VEST FROM <b>` — two statements,
    // so it's not a single offset expression.
    const res = await call(client, "vestlang_resolve_offset", {
      expr: "DATE 2025-01-01 PLUS VEST FROM DATE 2025-02-01",
      grant_date: "2025-01-01",
    });
    expect(res.isError).toBeFalsy();
    expect(sc(res).ok).toBe(false);
    expect(sc(res).error?.ruleId).toBe("offset-not-single-expression");
  });

  it("resolve_offset refuses an unfired EVENT with offset-unresolved", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_resolve_offset", {
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
    });
    expect(res.isError).toBeFalsy();
    expect(sc(res).ok).toBe(false);
    expect(sc(res).error?.ruleId).toBe("offset-unresolved");
  });

  // rehydrate's four refusal modes. Missing-grant-date is reachable by stripping
  // the stored grant date; the other three need a hand-built artifact. The
  // template itself must be schema-valid (a non-empty statements array) — the
  // refusal is about the runtime, not the template.
  describe("rehydrate refusal modes (ruleId now on the wire)", () => {
    it("rehydrate-missing-grant-date — stored grant date stripped", async () => {
      const client = await connectClient();
      const res = await call(client, "vestlang_rehydrate", {
        artifact: {
          template: {
            object_type: "VESTING_TERMS",
            id: "t1",
            statements: [
              {
                order: 1,
                percentage: "1",
                event_condition: { event_id: "ipo" },
              },
            ],
          },
          runtime: { startDate: "2025-01-01" },
        },
        grant_quantity: 400,
      });
      expect(res.isError).toBeFalsy();
      expect(sc(res).ok).toBe(false);
      expect(sc(res).error?.ruleId).toBe("rehydrate-missing-grant-date");
    });

    it("rehydrate-over-allocation — a hand-built template that over-vests", async () => {
      const client = await connectClient();
      // A single statement allocating 200% of the grant — over-vesting.
      const res = await call(client, "vestlang_rehydrate", {
        artifact: {
          template: {
            object_type: "VESTING_TERMS",
            id: "t1",
            statements: [
              {
                order: 1,
                schedule: {
                  occurrences: 4,
                  period: 1,
                  period_type: "MONTHS",
                },
                percentage: "2",
              },
            ],
          },
          runtime: { grantDate: "2025-01-01", startDate: "2025-01-01" },
        },
        grant_quantity: 400,
      });
      expect(res.isError).toBeFalsy();
      expect(sc(res).ok).toBe(false);
      expect(sc(res).error?.ruleId).toBe("rehydrate-over-allocation");
    });

    it("rehydrate-corrupt-definition — the reserved evt:start recipe no longer parses", async () => {
      const client = await connectClient();
      // The reserved `evt:start` recipe is garbage, so rehydrate reparses it and the
      // reparse throws (the helper's computed key overwrites the valid placeholder).
      const res = await call(client, "vestlang_rehydrate", {
        artifact: corruptArtifact("evt:start", "TOTALLY NOT DSL (("),
        grant_quantity: 400,
      });
      expect(res.isError).toBeFalsy();
      expect(sc(res).ok).toBe(false);
      expect(sc(res).error?.ruleId).toBe("rehydrate-corrupt-definition");
    });

    it("rehydrate-namespace-violation — a sidecar key outside the reserved evt: namespace", async () => {
      const client = await connectClient();
      // `evt_1` is a legal user Ident, NOT the reserved `evt:` prefix, so it would
      // alias a real user event — the namespace guard turns it away before reparse.
      // It sits alongside a valid `evt:start` recipe, so the stray key is what trips.
      const res = await call(client, "vestlang_rehydrate", {
        artifact: corruptArtifact("evt_1", "DATE 2025-01-01"),
        grant_quantity: 400,
      });
      expect(res.isError).toBeFalsy();
      expect(sc(res).ok).toBe(false);
      expect(sc(res).error?.ruleId).toBe("rehydrate-namespace-violation");
    });
  });
});

/* ====================================================================
 * AC#3 — refusal sub-fields preserved inside `error`.
 * ==================================================================== */

describe("#345 AC#3 — typed sub-fields ride inside error", () => {
  it("a syntax-error carries error.loc (line/column span)", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_parse", {
      dsl: "VEST FROM DATE 2025-01-01 NONSENSE",
    });
    expect(sc(res).ok).toBe(false);
    const error = sc(res).error as {
      ruleId: string;
      loc?: { start: { line: number; column: number } };
    };
    expect(error.ruleId).toBe("syntax-error");
    expect(error.loc).toBeDefined();
    expect(error.loc?.start.line).toBeTypeOf("number");
    expect(error.loc?.start.column).toBeTypeOf("number");
  });

  it("an offset-unresolved refusal carries error.unresolved", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_resolve_offset", {
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
    });
    expect(sc(res).ok).toBe(false);
    const error = sc(res).error as { ruleId: string; unresolved?: string };
    expect(error.ruleId).toBe("offset-unresolved");
    expect(error.unresolved).toBe("EVENT ipo");
  });
});

/* ====================================================================
 * AC#4 — exceptions stay on isError, never as ok: false.
 * ==================================================================== */

describe("#345 AC#4 — genuine exceptions stay isError, with no ok discriminant", () => {
  it("stringify with a malformed AST is isError, not ok: false", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_stringify", { ast: "{ not json" });
    expect(res.isError).toBe(true);
    // No structured envelope: the result has no `ok` discriminant.
    expect(res.structuredContent).toBeUndefined();
  });

  it("infer_schedule with un-inferrable input is isError, not ok: false", async () => {
    const client = await connectClient();
    // A fractional amount is rejected by the input schema (a zod throw → isError).
    const res = await call(client, "vestlang_infer_schedule", {
      tranches: [{ date: "2025-01-01", amount: 31.25 }],
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
  });
});

/* ====================================================================
 * AC#5 — lint envelope vs. domain rename.
 * ==================================================================== */

describe("#345 AC#5 — lint's envelope ok is distinct from its domain errorFree", () => {
  async function lint(client: Client, dsl: string): Promise<StructuredContent> {
    const res = await call(client, "vestlang_lint", { dsl });
    expect(res.isError).toBeFalsy();
    return sc(res);
  }

  it("a warning-only DSL is ok: true (envelope), errorFree: true, clean: false", async () => {
    const client = await connectClient();
    const out = await lint(client, "1/2 VEST OVER 12 months EVERY 1 month");
    expect(out.ok).toBe(true);
    expect(out.errorFree).toBe(true);
    expect(out.clean).toBe(false);
  });

  it("an error-severity DSL still answers ok: true with errorFree: false", async () => {
    const client = await connectClient();
    const out = await lint(
      client,
      "VEST FROM EVENT x AFTER DATE 2026-01-01 AND BEFORE DATE 2025-01-01 OVER 48 months EVERY 1 month",
    );
    expect(out.ok).toBe(true);
    expect(out.errorFree).toBe(false);
  });

  it("no tool result exposes a domain `ok` field anymore (lint uses errorFree)", async () => {
    const client = await connectClient();
    const out = await lint(client, "1/2 VEST OVER 12 months EVERY 1 month");
    // `ok` is now strictly the envelope flag; the old domain meaning is errorFree.
    expect(out).toHaveProperty("errorFree");
    expect(out.ok).toBe(true);
  });
});

/* ====================================================================
 * AC#6 — message bytes are frozen (one refusal per refusal-capable tool).
 * The strings below are hardcoded literal baselines pinned to today's text.
 * ==================================================================== */

describe("#345 AC#6 — refusal message bytes are unchanged", () => {
  it("freezes one message + ruleId per refusal-capable tool", async () => {
    const client = await connectClient();

    // parse — syntax-error
    const parse = await call(client, "vestlang_parse", {
      dsl: "this is not vestlang",
    });
    expect(sc(parse).error?.ruleId).toBe("syntax-error");
    expect(sc(parse).error?.message).toBe(
      'Expected ".", "VEST", [ \\t\\r\\n], [0-1], or [0-9] but "t" found.',
    );

    // compile — syntax-error (same parser, same message)
    const compile = await call(client, "vestlang_compile", {
      dsl: "this is not vestlang",
    });
    expect(sc(compile).error?.ruleId).toBe("syntax-error");
    expect(sc(compile).error?.message).toBe(
      'Expected ".", "VEST", [ \\t\\r\\n], [0-1], or [0-9] but "t" found.',
    );

    // vested_between — evaluation-error (from > to)
    const between = await call(client, "vestlang_vested_between", {
      dsl: "VEST FROM DATE 2025-01-01 OVER 48 months EVERY 1 month",
      ...GRANT,
      from: "2025-12-31",
      to: "2025-01-01",
    });
    expect(sc(between).error?.ruleId).toBe("evaluation-error");
    expect(sc(between).error?.message).toBe(
      "Invalid window: from (2025-12-31) is after to (2025-01-01)",
    );

    // evaluate — evaluation-error (installment cap)
    const evaluate = await call(client, "vestlang_evaluate", {
      dsl: "VEST OVER 1000000 months EVERY 1 month",
      ...GRANT,
    });
    expect(sc(evaluate).error?.ruleId).toBe("evaluation-error");
    expect(sc(evaluate).error?.message).toBe(
      "schedule expands to 1000000 installments, exceeds the limit of 10000",
    );

    // evaluate_as_of — evaluation-error (the cap fires during evaluation, before
    // any as-of filtering, so the message is identical to evaluate's)
    const evaluateAsOf = await call(client, "vestlang_evaluate_as_of", {
      dsl: "VEST OVER 1000000 months EVERY 1 month",
      ...GRANT,
      as_of: "2026-01-01",
    });
    expect(sc(evaluateAsOf).error?.ruleId).toBe("evaluation-error");
    expect(sc(evaluateAsOf).error?.message).toBe(
      "schedule expands to 1000000 installments, exceeds the limit of 10000",
    );

    // persist — persist-not-storable (two independent date grids → events-only)
    const persist = await call(client, "vestlang_persist", {
      dsl:
        "1/2 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 12 months " +
        "PLUS 1/2 VEST FROM DATE 2025-07-01 OVER 12 months EVERY 12 months",
      ...GRANT,
    });
    expect(sc(persist).error?.ruleId).toBe("persist-not-storable");
    expect(sc(persist).error?.message).toBe(
      'Only a single-template program is storable as a persisted artifact; this program\'s storable form is "events-only". Adjust the schedule so it collapses to a single canonical template.',
    );

    // rehydrate — rehydrate-missing-grant-date (#293 hardened message). The
    // template is schema-valid (non-empty statements); only the runtime's stored
    // grant date is missing.
    const rehydrate = await call(client, "vestlang_rehydrate", {
      artifact: {
        template: {
          object_type: "VESTING_TERMS",
          id: "t1",
          statements: [
            { order: 1, percentage: "1", event_condition: { event_id: "ipo" } },
          ],
        },
        runtime: { startDate: "2025-01-01" },
      },
      grant_quantity: 400,
    });
    expect(sc(rehydrate).error?.ruleId).toBe("rehydrate-missing-grant-date");
    expect(sc(rehydrate).error?.message).toBe(
      "Cannot rehydrate: the artifact's runtime is missing its stored grant date (runtime.grantDate). A persisted artifact always carries it; supply one built by vestlang_persist.",
    );

    // resolve_offset — offset-unresolved
    const offset = await call(client, "vestlang_resolve_offset", {
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01",
    });
    expect(sc(offset).error?.ruleId).toBe("offset-unresolved");
    expect(sc(offset).error?.message).toBe(
      "Expression is unresolved: EVENT ipo",
    );
  });

  it("rehydrate-corrupt-definition message is frozen", async () => {
    const client = await connectClient();
    const res = await call(client, "vestlang_rehydrate", {
      artifact: corruptArtifact("evt:start", "TOTALLY NOT DSL (("),
      grant_quantity: 400,
    });
    expect(sc(res).error?.ruleId).toBe("rehydrate-corrupt-definition");
    expect(sc(res).error?.message).toBe(
      'Cannot rehydrate: the stored recipe for "evt:start" is corrupt or unparseable. The artifact appears to be damaged; supply one built by vestlang_persist.',
    );
  });
});

// AC#1 closure note: rehydrate's success arm is exercised above via
// persistBareEvent in spirit; this driver keeps that fixture referenced for the
// suite without re-asserting the persistence mechanics (owned by persist.test.ts).
describe("#345 — rehydrate success arm sanity", () => {
  it("a persisted bare-event artifact rehydrates ok: true", async () => {
    const client = await connectClient();
    const artifact = await persistBareEvent(client);
    const res = await call(client, "vestlang_rehydrate", {
      artifact,
      grant_quantity: 400,
      events: { ipo: "2025-01-31" },
    });
    expect(res.isError).toBeFalsy();
    expect(sc(res).ok).toBe(true);
  });
});
