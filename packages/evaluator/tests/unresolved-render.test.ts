// When a start can't pin a date but its cadence is still known — a LATER OF whose
// later arm has already resolved, leaving only an unfired event to wait on — the
// unresolved projection lays the schedule out as per-tranche `start + N` symbolic
// installments, not one undated lump. That detail tells a record-keeper the shape
// of the schedule even before the anchor is known, so it must survive the move to
// rendering from the resolvesTo record.
//
// `LATER OF(grantDate + 12 months, EVENT ipo)` start (the +12mo arm resolves, ipo
// pending) over a 48-month grid, with an event cliff that keeps the whole program
// unresolved. Each of the 48 tranches should be a START_PLUS step.

import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate";
import { unresolvedInstallments } from "../src/resolve/unresolved.js";
import { baseCtx } from "./helpers";
import type { StmtResolution } from "../src/resolve/lower.js";

const DSL =
  "VEST FROM LATER OF(grantDate + 12 months, EVENT ipo) " +
  "OVER 48 months EVERY 1 month CLIFF EVENT board";

describe("partially-resolved combinator start keeps its START_PLUS cadence", () => {
  it("projects one START_PLUS tranche per occurrence in the template's pending stream", () => {
    // `LATER OF(gd + 12mo, EVENT ipo)` start (combinator, ipo pending) + `CLIFF
    // EVENT board` → a COMPOUND template (a synthetic contingent start + the cliff's
    // event_condition). The combinator start's cadence still renders as START_PLUS
    // tranches, now in the template verdict's pending installments.
    const program = normalizeProgram(parse(DSL));
    const { resolvesTo } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo and board both unfired
      grantQuantity: 4800,
    });

    expect(resolvesTo.status).toBe("template");
    if (resolvesTo.status !== "template") return;

    expect(resolvesTo.installments).toHaveLength(48);
    expect(
      resolvesTo.installments.every(
        (i) => i.state === "UNRESOLVED" && i.symbolicDate.type === "START_PLUS",
      ),
    ).toBe(true);
    // No grant-date fold runs on this path, so the months count up cleanly: the
    // first tranche reads START + 1 month and the last START + 48 months.
    const steps = resolvesTo.installments.map((i) =>
      i.state === "UNRESOLVED" && i.symbolicDate.type === "START_PLUS"
        ? i.symbolicDate.steps
        : undefined,
    );
    expect(steps).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
    expect(resolvesTo.installments.every((i) => i.amount === 100)).toBe(true);
    expect(
      resolvesTo.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });
});

// The cliff mirror of the above: `CLIFF LATER OF(vestingStart + 12mo, EVENT ipo)`
// on a dated start now stores as an event_condition (the time baseline in `cliff`,
// the event hold in `event_condition`). Unfired, the whole grid — including the
// 12-month lump — is held (AC 7: the floor is the hold, not an unresolved verdict).
// So it's a TEMPLATE that releases nothing; the held grid renders symbolically.
describe("partial LATER OF cliff holds the whole grid (the floor is the hold)", () => {
  const DSL =
    "VEST FROM grantDate OVER 48 months EVERY 1 month " +
    "CLIFF LATER OF(vestingStart + 12 months, EVENT ipo)";

  it("template; every share held as an UNRESOLVED_CLIFF tranche, nothing released", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolvesTo } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo unfired → the event_condition holds
      grantQuantity: 4800,
    });

    expect(resolvesTo.status).toBe("template");
    if (resolvesTo.status !== "template") return;

    // The whole grid is held (no RESOLVED tranche), rendered as cliff lumps.
    expect(
      resolvesTo.installments.every(
        (i) =>
          i.state === "UNRESOLVED" &&
          i.symbolicDate.type === "UNRESOLVED_CLIFF",
      ),
    ).toBe(true);
    // Shares are conserved in the held stream.
    expect(resolvesTo.installments.reduce((sum, i) => sum + i.amount, 0)).toBe(
      4800,
    );
    expect(
      resolvesTo.pending.some(
        (b) => b.type === "EVENT_NOT_YET_OCCURRED" && b.event === "ipo",
      ),
    ).toBe(true);
  });

  // Disclose-the-floor (#447): each held tranche carries the resolved `+12 months`
  // arm as its `floor` (the earliest it could land), while its cadence `date` stays
  // at the honest grid position — NOT folded onto the floor. The anti-fold pin
  // (#447 AC 4) lives in the same test: it must fail if a future change re-folds.
  it("discloses the floor on each held tranche while keeping cadence dates honest", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolvesTo } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // ipo unfired
      grantQuantity: 4800,
    });

    expect(resolvesTo.status).toBe("template");
    if (resolvesTo.status !== "template") return;

    const symbolic = resolvesTo.installments.map((i) =>
      i.state === "UNRESOLVED" && i.symbolicDate.type === "UNRESOLVED_CLIFF"
        ? i.symbolicDate
        : undefined,
    );

    // Every held tranche carries floor = the +12mo mark (2026-01-01).
    expect(symbolic.every((s) => s?.floor === "2026-01-01")).toBe(true);

    // The first held tranche keeps its honest cadence date (2025-02-01 off a
    // monthly grid from the 2025-01-01 start) AND discloses the floor; the grid
    // runs through 2029-01-01, never collapsed onto the floor.
    expect(symbolic[0]).toEqual({
      type: "UNRESOLVED_CLIFF",
      date: "2025-02-01",
      floor: "2026-01-01",
    });
    expect(symbolic[symbolic.length - 1]?.date).toBe("2029-01-01");

    // The fold guard: the early cadence dates sit strictly BELOW the floor — if a
    // future change folded the grid onto the floor, none would (the whole pre-floor
    // run would collapse to 2026-01-01). The first eleven months are all below it.
    const belowFloor = symbolic
      .map((s) => s?.date)
      .filter((d) => d !== undefined && d < "2026-01-01");
    expect(belowFloor).toEqual([
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
      "2025-05-01",
      "2025-06-01",
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
      "2025-10-01",
      "2025-11-01",
      "2025-12-01",
    ]);
  });
});

// Bare `CLIFF EVENT e` — no time arm at all, so no known floor. The held tranches
// render WITHOUT a `floor` key (#447 AC 3, the negative pin defending the field's
// optionality). The cadence dates are unchanged from a no-cliff grid.
describe("bare event cliff holds the grid with no floor disclosed", () => {
  const DSL =
    "VEST FROM grantDate OVER 48 months EVERY 1 month CLIFF EVENT board";

  it("renders every held UNRESOLVED_CLIFF tranche with the floor key absent", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolvesTo } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // board unfired → the event hold stands
      grantQuantity: 4800,
    });

    expect(resolvesTo.status).toBe("template");
    if (resolvesTo.status !== "template") return;

    const symbolic = resolvesTo.installments.map((i) =>
      i.state === "UNRESOLVED" && i.symbolicDate.type === "UNRESOLVED_CLIFF"
        ? i.symbolicDate
        : undefined,
    );
    // Every tranche is an UNRESOLVED_CLIFF, and none carries a `floor` key — the
    // `in` check (rather than `=== undefined`) also defends against a regression
    // that defaulted the key to `floor: undefined`.
    expect(symbolic.every((s) => s !== undefined && !("floor" in s))).toBe(
      true,
    );
    // Honest cadence dates, unchanged from the no-cliff grid.
    expect(symbolic[0]?.date).toBe("2025-02-01");
  });
});

// A resolved start with a gated event cliff (`CLIFF EVENT board BEFORE DATE …`)
// now stores as a SYNTHETIC event_condition (the gate captured in its recipe), so
// it's a template held until board fires. The held grid renders as dated cliff
// lumps (UNRESOLVED_CLIFF), never the start-relative START_PLUS form.
describe("resolved start with a pending gated-event cliff renders dated, not START_PLUS", () => {
  const DSL =
    "VEST FROM grantDate OVER 4 months EVERY 1 month " +
    "CLIFF EVENT board BEFORE DATE 2030-01-01";

  it("template; renders every held installment as UNRESOLVED_CLIFF and none as START_PLUS", () => {
    const program = normalizeProgram(parse(DSL));
    const { resolvesTo } = evaluateProgram(program, {
      grantDate: "2025-01-01",
      events: {}, // board unfired → the event_condition holds
      grantQuantity: 400,
    });

    expect(resolvesTo.status).toBe("template");
    if (resolvesTo.status !== "template") return;

    expect(resolvesTo.installments.length).toBeGreaterThan(0);
    expect(
      resolvesTo.installments.every(
        (i) =>
          i.state === "UNRESOLVED" &&
          i.symbolicDate.type === "UNRESOLVED_CLIFF",
      ),
    ).toBe(true);
    expect(
      resolvesTo.installments.some(
        (i) => i.state === "UNRESOLVED" && i.symbolicDate.type === "START_PLUS",
      ),
    ).toBe(false);
  });
});

// White-box guard for the impossible dated-start + symbolic-cliff pairing. The
// real pipeline can't construct this record (a symbolic cliff only pairs with a
// pending start), so we hand-build one and call the renderer directly to prove
// it throws — and throws the *invariant* error, not some unrelated one from the
// fold/grid block that runs first. A coherent record (concrete date, head role,
// non-zero cadence) keeps that earlier block harmless, so the only thing left to
// blow up is the guarded arm.
describe("unresolvedInstallments rejects a dated start with a symbolic cliff", () => {
  it("throws naming the broken start/cliff-shape invariant", () => {
    const r: StmtResolution = {
      percentage: { numerator: 1, denominator: 1 },
      periodicity: { type: "MONTHS", length: 1, occurrences: 12 },
      start: { state: "RESOLVED", date: "2025-01-01", base: { type: "DATE" } },
      chain: { role: "head" },
      cliff: { state: "UNRESOLVED", blockers: [], shape: { kind: "symbolic" } },
    };

    expect(() => unresolvedInstallments(r, baseCtx(), 100)).toThrow(
      /symbolic/i,
    );
  });
});
