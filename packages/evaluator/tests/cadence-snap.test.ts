// Issue #253 — a displacement (offset / gate boundary) is an exact duration; only
// cadence (the grid, and a cliff's own vestingStart anchor) snaps to the
// day-of-month policy. These run the real evaluate path (parse → normalize →
// evaluateProgram) at user altitude, because the program-level facts — a gate
// clearing under a numeric policy, the cliff still snapping, the cliff.percentage
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
import { evaluateProgram } from "../src/orchestrate";

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

// ---- AC4: the gate boundary is exact (the #351 construct). A
// `vesting_start + 6 months` gate is a comparison boundary, not a vesting date,
// so it never snaps — even though it references the same `vesting_start` anchor a
// cadence cliff would snap on. The grid still snaps, so the amounts legitimately
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
    expect(s.resolution.status).toBe("events-only");
    expect(allResolved(s.resolution.installments)).toBe(true);
    expect(s.cliffDate).toBe("2025-07-12");
    // Default grid lands on the 10th, so 6 installments accrue by 07-12; the cliff
    // folds them into a 500 lump (6/12 of 1000), remainder over the 6 later ones.
    expect(s.resolution.installments).toEqual([
      { state: "RESOLVED", amount: 500, date: "2025-07-12" },
      { state: "RESOLVED", amount: 83, date: "2025-08-10" },
      { state: "RESOLVED", amount: 83, date: "2025-09-10" },
      { state: "RESOLVED", amount: 84, date: "2025-10-10" },
      { state: "RESOLVED", amount: 83, date: "2025-11-10" },
      { state: "RESOLVED", amount: 83, date: "2025-12-10" },
      { state: "RESOLVED", amount: 84, date: "2026-01-10" },
    ]);
  });

  it("clears the SAME exact gate under policy '15' (was dead before #253)", () => {
    const s = evaluate(DSL, { events, vesting_day_of_month: "15" });
    expect(s.resolution.status).toBe("events-only");
    expect(allResolved(s.resolution.installments)).toBe(true);
    expect(s.cliffDate).toBe("2025-07-12");
    // The grid snaps to the 15th, so only 5 installments accrue by 07-12 (Jul-15
    // is after) → a 416 lump (5/12 of 1000, cumulative round-down), remainder over
    // the 7 later installments. The amounts differ from the default run; the gate
    // verdict does NOT.
    expect(s.resolution.installments).toEqual([
      { state: "RESOLVED", amount: 416, date: "2025-07-12" },
      { state: "RESOLVED", amount: 84, date: "2025-07-15" },
      { state: "RESOLVED", amount: 83, date: "2025-08-15" },
      { state: "RESOLVED", amount: 83, date: "2025-09-15" },
      { state: "RESOLVED", amount: 84, date: "2025-10-15" },
      { state: "RESOLVED", amount: 83, date: "2025-11-15" },
      { state: "RESOLVED", amount: 83, date: "2025-12-15" },
      { state: "RESOLVED", amount: 84, date: "2026-01-15" },
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

  it("no firing → storable template with cliff.percentage 12/48 (under policy '15')", () => {
    const s = evaluate(DSL, { vesting_day_of_month: "15" });
    expect(s.interchange.status).toBe("template");
    if (s.interchange.status !== "template") return; // narrow
    const stmt = s.interchange.template.statements[0];
    // The bare 12-month cliff over a 48-month grid is 12/48 = 1/4; the typed
    // Fraction is stored in reduced form.
    expect(stmt.cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: { numerator: 1, denominator: 4 },
    });
  });

  it("with firing → the cliff lump lands on the policy day (the 15th), 250 shares", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "15",
      events: { ipo: "2025-03-10" },
    });
    expect(s.resolution.status).toBe("template");
    const resolved = s.resolution.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    // The cliff lump is the 12th grid installment — 1/4 of 1000 = 250 — on the
    // snapped policy day (the 15th), unchanged from pre-#253.
    expect(resolved[0]).toEqual({
      state: "RESOLVED",
      amount: 250,
      date: "2026-03-15",
    });
  });

  it("no firing under the DEFAULT policy → same storable cliff.percentage", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    });
    expect(s.interchange.status).toBe("template");
    if (s.interchange.status !== "template") return; // narrow
    expect(s.interchange.template.statements[0].cliff).toEqual({
      length: 12,
      period_type: "MONTHS",
      percentage: { numerator: 1, denominator: 4 },
    });
  });

  it("with firing under the DEFAULT policy → 250 lump on the default grid day", () => {
    const s = evaluate(DSL, {
      vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      events: { ipo: "2025-03-10" },
    });
    expect(s.resolution.status).toBe("template");
    const resolved = s.resolution.installments.filter(
      (i) => i.state === "RESOLVED",
    );
    // The default grid keeps ipo's day (the 10th); the cliff lands on the 12th
    // installment, 2026-03-10 — the same 250 lump shape as the "15" run, on the
    // default grid day.
    expect(resolved[0]).toEqual({
      state: "RESOLVED",
      amount: 250,
      date: "2026-03-10",
    });
  });
});

// ---- AC7: the recurring grid is unchanged — a monthly schedule under policy
// '15' still lands every installment on the 15th. (The day-of-month wrapper's own
// snap is pinned separately in time.addMonths.test.ts.)

describe("#253 AC7 — recurring grid unchanged (still snaps to the 15th)", () => {
  it("a monthly schedule under policy '15' lands every installment on the 15th", () => {
    const s = evaluate(
      "1000 VEST FROM DATE 2025-01-10 OVER 4 months EVERY 1 month",
      { vesting_day_of_month: "15" },
    );
    expect(s.resolution.status).toBe("template");
    expect(dates(s.resolution.installments)).toEqual([
      "2025-02-15",
      "2025-03-15",
      "2025-04-15",
      "2025-05-15",
    ]);
  });
});
