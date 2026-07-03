// Issue #253 — a displacement (offset / gate boundary) is an exact duration; only
// cadence (the grid, and a cliff's own vestingStart anchor) snaps to the
// day-of-month policy. These run the real evaluate path (parse → normalize →
// evaluateProgram) at user altitude, because the program-level facts — a gate
// clearing under a non-default policy, the cliff still snapping, the cliff.percentage
// on the typed interchange template — aren't visible at the offset surface. The
// offset-exactness unit assertions live in vestingBase.test.ts.

import { describe, it, expect } from "vitest";
import type {
  EvaluatedSchedule,
  Installment,
  ResolutionContextInput,
  VestingDayOfMonth,
} from "@vestlang/types";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgram } from "../src/evaluate";
import { scheduleOf } from "./helpers";

const evaluate = (
  dsl: string,
  ctx: Partial<ResolutionContextInput> & {
    vesting_day_of_month?: VestingDayOfMonth;
  },
): EvaluatedSchedule => {
  const program = normalizeProgram(parse(dsl));
  return evaluateProgram(program, {
    grantDate: "2025-01-01",
    events: {},
    grantQuantity: 1000,
    ...ctx,
  });
};

const dates = (installments: Installment[]) =>
  installments.map((i) => (i.state === "RESOLVED" ? i.date : i.state));
const allResolved = (installments: Installment[]) =>
  installments.every((i) => i.state === "RESOLVED");

// ---- AC4: the gate boundary is exact (the #351 construct). A cliff's
// `vesting_start + 6 months` gate is a comparison boundary, not a vesting date,
// so it never snaps — even though it references the same `vesting_start` anchor a
// cadence cliff would snap on. (A vestingStart gate is legal only on a cliff; on a
// start it would be circular.) The grid still snaps, so the amounts legitimately
// differ by policy; the gate's verdict does not.

describe("#253 AC4 — vesting_start gate boundary is exact, grid still snaps", () => {
  const DSL =
    "1000 VEST FROM DATE 2025-01-10 OVER 12 months EVERY 1 month CLIFF EVENT acceleration AFTER vesting_start + 6 months";
  // acceleration lands two days after the exact gate (vesting_start + 6mo =
  // 2025-07-10). Under a snapped gate (2025-07-15) it would fall BEFORE the gate
  // and the cliff would be dead — that's the bug. With the gate exact it clears.
  const events = { acceleration: "2025-07-12" };

  it("clears the gate (resolvable, not dead) under the DEFAULT policy", () => {
    const s = evaluate(DSL, { events });
    // A gated event cliff that fired and cleared its gate → a template (synthetic
    // event_condition), folded by core.compile to the same lump.
    expect(s.resolvesTo.status).toBe("template");
    expect(allResolved(s.resolvesTo.installments)).toBe(true);
    // Default grid lands on the 10th, so 6 installments accrue by 07-12; the cliff
    // folds them into a 500 lump (6/12 of 1000), remainder over the 6 later ones.
    expect(s.resolvesTo.installments).toEqual([
      { state: "RESOLVED", amount: 500, date: "2025-07-12" },
      { state: "RESOLVED", amount: 83, date: "2025-08-10" },
      { state: "RESOLVED", amount: 83, date: "2025-09-10" },
      { state: "RESOLVED", amount: 84, date: "2025-10-10" },
      { state: "RESOLVED", amount: 83, date: "2025-11-10" },
      { state: "RESOLVED", amount: 83, date: "2025-12-10" },
      { state: "RESOLVED", amount: 84, date: "2026-01-10" },
    ]);
  });

  it("clears the SAME exact gate under policy LAST_DAY_OF_MONTH (was dead before #253)", () => {
    const s = evaluate(DSL, {
      events,
      vesting_day_of_month: "LAST_DAY_OF_MONTH",
    });
    expect(s.resolvesTo.status).toBe("template");
    expect(allResolved(s.resolvesTo.installments)).toBe(true);
    // The grid snaps to month-end, so only 5 installments accrue by 07-12 (Jul-31
    // is after) → a 416 lump (5/12 of 1000, cumulative round-down), remainder over
    // the 7 later installments. The amounts differ from the default run; the gate
    // verdict does NOT.
    expect(s.resolvesTo.installments).toEqual([
      { state: "RESOLVED", amount: 416, date: "2025-07-12" },
      { state: "RESOLVED", amount: 84, date: "2025-07-31" },
      { state: "RESOLVED", amount: 83, date: "2025-08-31" },
      { state: "RESOLVED", amount: 83, date: "2025-09-30" },
      { state: "RESOLVED", amount: 84, date: "2025-10-31" },
      { state: "RESOLVED", amount: 83, date: "2025-11-30" },
      { state: "RESOLVED", amount: 83, date: "2025-12-31" },
      { state: "RESOLVED", amount: 84, date: "2026-01-31" },
    ]);
  });
});

// ---- AC6: the cliff still snaps; storability is preserved. The bare-duration
// cliff `CLIFF 12 months` lowers to `vestingStart + 12mo` — cadence, so it keeps
// snapping. A pending-event cliff in months stays a storable `template` carrying
// the proportional cliff.percentage.

describe("#253 AC6 — cliff still snaps; storability preserved", () => {
  const DSL =
    "1000 VEST FROM EVENT ipo OVER 48 months EVERY 1 month CLIFF 12 months";

  it("no firing → storable template with cliff.percentage 12/48 (under policy LAST_DAY_OF_MONTH)", () => {
    const s = evaluate(DSL, { vesting_day_of_month: "LAST_DAY_OF_MONTH" });
    expect(s.storable.status).toBe("template");
    if (s.storable.status !== "template") return; // narrow
    const stmt = s.storable.template.statements[0];
    // The bare 12-month cliff over a 48-month grid is 12/48 = 1/4; the typed
    // Fraction is stored in reduced form.
    expect(scheduleOf(stmt)!.cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: "0.25",
    });
  });

  it("with firing → the cliff lump lands on the policy day (the month-end), 250 shares", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "LAST_DAY_OF_MONTH",
      events: { ipo: "2025-03-10" },
    });
    expect(s.resolvesTo.status).toBe("template");
    const resolved = s.resolvesTo.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    // The cliff lump is the 12th grid installment — 1/4 of 1000 = 250 — on the
    // snapped policy day (March's month-end), unchanged from pre-#253.
    expect(resolved[0]).toEqual({
      state: "RESOLVED",
      amount: 250,
      date: "2026-03-31",
    });
  });

  it("no firing under the DEFAULT policy → same storable cliff.percentage", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "VESTING_START_DAY",
    });
    expect(s.storable.status).toBe("template");
    if (s.storable.status !== "template") return; // narrow
    expect(scheduleOf(s.storable.template.statements[0])!.cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: "0.25",
    });
  });

  it("with firing under the DEFAULT policy → 250 lump on the default grid day", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "VESTING_START_DAY",
      events: { ipo: "2025-03-10" },
    });
    expect(s.resolvesTo.status).toBe("template");
    const resolved = s.resolvesTo.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    // The default grid keeps ipo's day (the 10th); the cliff lands on the 12th
    // installment, 2026-03-10 — the same 250 lump shape as the LAST_DAY_OF_MONTH
    // run, on the default grid day.
    expect(resolved[0]).toEqual({
      state: "RESOLVED",
      amount: 250,
      date: "2026-03-10",
    });
  });
});

// ---- AC7: the recurring grid is unchanged — a monthly schedule under policy
// LAST_DAY_OF_MONTH still lands every installment on the month-end. (The
// day-of-month wrapper's own snap is pinned separately in time.addMonths.test.ts.)

describe("#253 AC7 — recurring grid unchanged (still snaps to the month-end)", () => {
  it("a monthly schedule under policy LAST_DAY_OF_MONTH lands every installment on the month-end", () => {
    const s = evaluate(
      "1000 VEST FROM DATE 2025-01-10 OVER 4 months EVERY 1 month",
      { vesting_day_of_month: "LAST_DAY_OF_MONTH" },
    );
    expect(s.resolvesTo.status).toBe("template");
    expect(dates(s.resolvesTo.installments)).toEqual([
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
      "2025-05-31",
    ]);
  });
});

// Under VESTING_START_DAY_MINUS_ONE the cliff baseline and the monthly grid both
// land on clamp-minus-one days. A Jan-31 monthly grid sits on Feb 27, Mar 30,
// Apr 29, … — one day before the plain VESTING_START_DAY run (Feb 28 / Mar 31 /
// Apr 30), and the cliff folds onto that same grid.
describe("VESTING_START_DAY_MINUS_ONE — cliff in MONTHS honors the policy end to end", () => {
  const DSL =
    "1000 VEST FROM DATE 2025-01-31 OVER 6 months EVERY 1 month CLIFF 3 months";

  it("folds the cliff onto the clamp-minus-one day and steps the tail there too", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "VESTING_START_DAY_MINUS_ONE",
    });
    expect(s.resolvesTo.status).toBe("template");
    expect(allResolved(s.resolvesTo.installments)).toBe(true);
    // Grid days under MINUS_ONE: Feb 27, Mar 30, Apr 29, May 30, Jun 29, Jul 30.
    // CLIFF 3 months lands on the 3rd grid day (2025-04-29), folding 3/6 of the
    // grant into a 500 lump; the remaining 500 spreads over the last three on
    // cumulative round-down (166 / 167 / 167).
    expect(s.resolvesTo.installments).toEqual([
      { state: "RESOLVED", amount: 500, date: "2025-04-29" },
      { state: "RESOLVED", amount: 166, date: "2025-05-30" },
      { state: "RESOLVED", amount: 167, date: "2025-06-29" },
      { state: "RESOLVED", amount: 167, date: "2025-07-30" },
    ]);
  });

  it("stores the cliff as a 3/6 fraction on the interchange template", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "VESTING_START_DAY_MINUS_ONE",
    });
    expect(s.storable.status).toBe("template");
    if (s.storable.status !== "template") return; // narrow
    expect(scheduleOf(s.storable.template.statements[0])!.cliff).toEqual({
      length: 3,
      period_type: "MONTHS",
      percentage: "0.5",
    });
  });
});
