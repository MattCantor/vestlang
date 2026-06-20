import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  Program,
  ResolutionContextInput,
  VestingNodeExpr,
} from "@vestlang/types";
import {
  evaluateProgram,
  evaluateStatement,
  evaluateClauseGroups,
  evaluateProgramAsOf,
  resolveVestingStart,
} from "../src/index.js";
import { installmentCapMessage } from "@vestlang/core";

// #335 / #355 — the evaluator's structural boundary guard. A hand-built Program
// (or bare start node) reaching the published evaluate surface bypasses the front
// end that would normally vet it, so the guard re-checks two things the type
// system can't enforce on an untrusted value: structural / calendar
// well-formedness (#335, reusing render's collector) and the circular
// vestingStart-start-gate rule (#355). Valid programs are unaffected.

const prog = (dsl: string) => normalizeProgram(parse(dsl));

const ctx = (
  over: Partial<ResolutionContextInput> = {},
): ResolutionContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 1000,
  ...over,
});

const asOfCtx = () => ({ ...ctx(), asOf: "2026-06-01" });

// A minimal valid one-statement program we then mutate to inject a bad value,
// so each test changes exactly the field under examination.
const validProgram = (): Program =>
  prog("1000 VEST OVER 12 months EVERY 1 month");

// Overwrite a DATE base's value in place with an impossible literal — the very
// thing a JS caller can hand the evaluator that the types forbid, and the runtime
// must still catch. Throws if the navigation misses a DATE, so a test can't
// silently pass on an un-mutated (still-valid) program.
const setDateValue = (base: unknown, bad: string): void => {
  const b = base as { type?: string; value?: string };
  if (b.type !== "DATE") throw new Error(`expected a DATE base, got ${b.type}`);
  b.value = bad;
};

const programWithBadStartDate = (bad: string): Program => {
  const p = prog(`1000 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month`);
  const stmt = p[0];
  if (stmt.expr.type !== "SCHEDULE" || stmt.expr.vesting_start?.type !== "NODE")
    throw new Error("fixture drift: expected a plain DATE start");
  setDateValue(stmt.expr.vesting_start.base, bad);
  return p;
};

const IMPOSSIBLE = "2025-02-31";

describe("#335 — runtime DATE-literal validation via the shared collector", () => {
  // AC1: an impossible DATE start literal throws a calendar-validity error rather
  // than silently rolling 2025-02-31 → 2025-03-03 or dying in the date kernel.
  it("rejects an impossible DATE start literal (no silent roll)", () => {
    expect(() =>
      evaluateProgram(programWithBadStartDate(IMPOSSIBLE), ctx()),
    ).toThrow(/not a valid calendar date/);
  });

  it("the rejection message is eval-voiced and names the offending value", () => {
    expect(() =>
      evaluateProgram(programWithBadStartDate(IMPOSSIBLE), ctx()),
    ).toThrow(/Cannot evaluate program:/);
    expect(() =>
      evaluateProgram(programWithBadStartDate(IMPOSSIBLE), ctx()),
    ).toThrow(/2025-02-31/);
  });

  // AC2: the bad literal hides off the start path — a cliff literal, a gate
  // reference base, and a selector arm — and is still caught.
  it("rejects an impossible cliff DATE literal", () => {
    const p = prog(
      `1000 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month CLIFF DATE 2025-06-15`,
    );
    const sched = p[0].expr;
    // Walk to the cliff node's DATE base and corrupt it.
    if (sched.type !== "SCHEDULE" || sched.periodicity.cliff?.type !== "NODE")
      throw new Error("fixture drift: expected a DATE cliff node");
    setDateValue(sched.periodicity.cliff.base, IMPOSSIBLE);
    expect(() => evaluateProgram(p, ctx())).toThrow(
      /not a valid calendar date/,
    );
  });

  it("rejects an impossible DATE in a gate-reference base (… AFTER 2025-02-31)", () => {
    const p = prog(
      `1000 VEST FROM DATE 2025-01-01 AFTER DATE 2025-06-15 OVER 12 months EVERY 1 month`,
    );
    const start = (p[0].expr as { vesting_start?: VestingNodeExpr | null })
      .vesting_start;
    if (start?.type !== "NODE" || start.condition?.type !== "ATOM")
      throw new Error("fixture drift: expected a gated DATE start");
    // constraint.base is the gate's reference NODE; its .base is the VestingBase.
    setDateValue(start.condition.constraint.base.base, IMPOSSIBLE);
    expect(() => evaluateProgram(p, ctx())).toThrow(
      /not a valid calendar date/,
    );
  });

  it("rejects an impossible DATE in a selector arm (EARLIER OF (…, 2025-02-31))", () => {
    const p = prog(
      `1000 VEST FROM EARLIER OF (DATE 2025-03-01, DATE 2025-06-15) OVER 12 months EVERY 1 month`,
    );
    const start = (p[0].expr as { vesting_start?: VestingNodeExpr | null })
      .vesting_start;
    if (start?.type !== "NODE_EARLIER_OF" || start.items[1].type !== "NODE")
      throw new Error("fixture drift: expected an EARLIER OF start");
    setDateValue(start.items[1].base, IMPOSSIBLE);
    expect(() => evaluateProgram(p, ctx())).toThrow(
      /not a valid calendar date/,
    );
  });

  // AC3: the guard fires on every public AST entry.
  it("fires on evaluateStatement", () => {
    expect(() =>
      evaluateStatement(programWithBadStartDate(IMPOSSIBLE)[0], ctx()),
    ).toThrow(/Cannot evaluate program:/);
  });

  it("fires on evaluateClauseGroups", () => {
    expect(() =>
      evaluateClauseGroups(programWithBadStartDate(IMPOSSIBLE), ctx()),
    ).toThrow(/Cannot evaluate program:/);
  });

  it("fires on evaluateProgramAsOf", () => {
    expect(() =>
      evaluateProgramAsOf(programWithBadStartDate(IMPOSSIBLE), asOfCtx()),
    ).toThrow(/Cannot evaluate program:/);
  });

  it("fires on resolveVestingStart (node-level variant)", () => {
    const p = programWithBadStartDate(IMPOSSIBLE);
    const start = (p[0].expr as { vesting_start: VestingNodeExpr })
      .vesting_start;
    expect(() => resolveVestingStart(start, ctx())).toThrow(
      /Cannot evaluate program:/,
    );
  });

  // AC4: several bad literals are collected and reported together (one throw).
  it("collects multiple bad literals into one message", () => {
    const p = prog(
      `1000 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month CLIFF DATE 2025-06-15`,
    );
    const sched = p[0].expr;
    if (
      sched.type !== "SCHEDULE" ||
      sched.vesting_start?.type !== "NODE" ||
      sched.periodicity.cliff?.type !== "NODE"
    )
      throw new Error("fixture drift: expected a DATE start and a DATE cliff");
    setDateValue(sched.vesting_start.base, "2025-02-31");
    setDateValue(sched.periodicity.cliff.base, "2025-13-01");
    let message = "";
    try {
      evaluateProgram(p, ctx());
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/2025-02-31/);
    expect(message).toMatch(/2025-13-01/);
  });

  // AC5: valid DATE literals are unaffected — same resolution as before the guard.
  it("a real leap day (2024-02-29) resolves unchanged", () => {
    const before = evaluateProgram(
      prog(`1000 VEST FROM DATE 2024-02-29 OVER 12 months EVERY 1 month`),
      ctx(),
    );
    expect(before.resolution.status).toBe("template");
    expect(() =>
      evaluateProgram(
        prog(`1000 VEST FROM DATE 2024-02-29 OVER 12 months EVERY 1 month`),
        ctx(),
      ),
    ).not.toThrow();
  });

  it("a far-future in-range date is unaffected", () => {
    expect(() =>
      evaluateProgram(
        prog(`1000 VEST FROM DATE 2099-12-31 OVER 12 months EVERY 1 month`),
        ctx(),
      ),
    ).not.toThrow();
  });

  // AC6: the error is distinguishable from the installment-cap error and a kernel
  // RangeError — only the boundary guard carries the eval-voiced prefix.
  it("the cap error does NOT carry the eval-guard prefix", () => {
    // A schedule that expands past the cap throws the cap message, not ours.
    const big = prog(`1000 VEST OVER 100000 months EVERY 1 month`);
    let message = "";
    try {
      evaluateProgram(big, ctx());
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(installmentCapMessage(100000));
    expect(message).not.toMatch(/Cannot evaluate program:/);
  });

  // AC7: reuse, not duplication — a malformed-but-non-date program (negative
  // cadence) is rejected by evaluateProgram too, proving the shared collector path.
  it("rejects a malformed non-date program (negative cadence), proving the shared path", () => {
    const p = validProgram();
    const sched = p[0].expr;
    if (sched.type === "SCHEDULE") {
      (sched.periodicity as { length: number }).length = -5;
    }
    expect(() => evaluateProgram(p, ctx())).toThrow(/Cannot evaluate program:/);
    expect(() => evaluateProgram(p, ctx())).toThrow(/non-negative integer/);
  });
});

describe("#355 — runtime circular-start-gate backstop", () => {
  // Build a start node whose gate references VESTING_START. The DSL/parser rejects
  // this (#354), so we hand-build the node directly — the very bypass the backstop
  // exists for.
  const startGatedOnVestingStart = (): VestingNodeExpr => ({
    type: "NODE",
    base: { type: "GRANT_DATE" },
    offsets: [],
    condition: {
      type: "ATOM",
      constraint: {
        type: "AFTER",
        base: { type: "NODE", base: { type: "VESTING_START" }, offsets: [] },
        strict: false,
      },
    },
  });

  const programWithCircularStartGate = (): Program => {
    const p = validProgram();
    const sched = p[0].expr;
    if (sched.type === "SCHEDULE") {
      sched.vesting_start = startGatedOnVestingStart();
    }
    return p;
  };

  // AC10: a hand-built program with a vestingStart-gate on a start is rejected at
  // the boundary, naming the circular dependency.
  it("rejects a circular vestingStart start-gate in a Program", () => {
    expect(() =>
      evaluateProgram(programWithCircularStartGate(), ctx()),
    ).toThrow(/circular/);
  });

  it("the message parallels the parser's #354 wording (names vestingStart + circular)", () => {
    let message = "";
    try {
      evaluateProgram(programWithCircularStartGate(), ctx());
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/vestingStart/);
    expect(message).toMatch(/circular/);
    expect(message).toMatch(/Cannot evaluate program:/);
  });

  // AC10: same via the bare-node path (resolveVestingStart).
  it("rejects a circular vestingStart start-gate via resolveVestingStart", () => {
    expect(() =>
      resolveVestingStart(startGatedOnVestingStart(), ctx()),
    ).toThrow(/circular/);
  });

  // AC10: the forbiddance reaches a nested gate and a selector arm at runtime too.
  it("rejects vestingStart nested inside the gate's reference (nested gate)", () => {
    const nested: VestingNodeExpr = {
      type: "NODE",
      base: { type: "GRANT_DATE" },
      offsets: [],
      condition: {
        type: "ATOM",
        constraint: {
          type: "AFTER",
          base: {
            type: "NODE",
            base: { type: "DATE", value: "2025-06-01" },
            offsets: [],
            condition: {
              type: "ATOM",
              constraint: {
                type: "AFTER",
                base: {
                  type: "NODE",
                  base: { type: "VESTING_START" },
                  offsets: [],
                },
                strict: false,
              },
            },
          },
          strict: false,
        },
      },
    };
    expect(() => resolveVestingStart(nested, ctx())).toThrow(/circular/);
  });

  it("rejects vestingStart hiding in a start selector arm", () => {
    const inArm: VestingNodeExpr = {
      type: "NODE_EARLIER_OF",
      items: [
        { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
        startGatedOnVestingStart(),
      ],
    };
    expect(() => resolveVestingStart(inArm, ctx())).toThrow(/circular/);
  });

  // AC11: the backstop does NOT reject the legal cases.
  it("a vestingStart gate on a CLIFF still evaluates (#351)", () => {
    // CLIFF EVENT acceleration AFTER vesting_start + 6 months — the legal cliff gate.
    const p = prog(
      `1000 VEST FROM DATE 2025-01-10 OVER 12 months EVERY 1 month CLIFF EVENT acceleration AFTER vesting_start + 6 months`,
    );
    expect(() =>
      evaluateProgram(p, ctx({ events: { acceleration: "2025-07-12" } })),
    ).not.toThrow();
  });

  it("a grantDate gate on a START still evaluates (#113)", () => {
    // A start gated on grantDate is legal — the gate references a resolvable anchor.
    const startOnGrantDateGate: VestingNodeExpr = {
      type: "NODE",
      base: { type: "DATE", value: "2025-06-01" },
      offsets: [],
      condition: {
        type: "ATOM",
        constraint: {
          type: "AFTER",
          base: { type: "NODE", base: { type: "GRANT_DATE" }, offsets: [] },
          strict: false,
        },
      },
    };
    expect(() =>
      resolveVestingStart(startOnGrantDateGate, ctx()),
    ).not.toThrow();
  });
});
