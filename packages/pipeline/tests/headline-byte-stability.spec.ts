import { describe, it, expect } from "vitest";
import type { Installment } from "@vestlang/types";
import {
  runEvaluate,
  runPersist,
  runRehydrate,
  type GrantInput,
} from "../src/index";

// AC8 (#442, D1): the headline allocation is byte-stable across the breakdown
// unification. These golden literals were captured from origin/main BEFORE the
// change and are asserted byte-for-byte — they are NOT regenerated from the
// refactored code. The pending / contingent-start rows are pinned in their FULL
// UNRESOLVED shape (state + amount + symbolicDate, no `date`), which a
// date+amount-only literal could not pin. The persist/rehydrate `projection` (the
// one byte-sensitive `compileToInstallments` consumer outside the assemble
// chokepoint) is captured too.

// A run of month-1st ISO dates, for the long uniform schedules.
const months = (year: number, month: number, n: number): string[] => {
  const out: string[] = [];
  let y = year;
  let m = month;
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}-01`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
};

const resolved = (
  dates: string[],
  amount: (i: number) => number,
): Installment[] =>
  dates.map((date, i) => ({ state: "RESOLVED", amount: amount(i), date }));

const headline = (dsl: string, g: GrantInput): Installment[] => {
  const r = runEvaluate(dsl, g);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("unexpected eval failure");
  return r.view.installments;
};

const GRANT_2025: GrantInput = {
  grant_date: "2025-01-01",
  grant_quantity: 1200,
};

describe("headline byte-stability — golden literals (#442 / D1)", () => {
  it("resolved monthly grid", () => {
    expect(headline("VEST OVER 12 months EVERY 1 month", GRANT_2025)).toEqual(
      resolved(months(2025, 2, 12), () => 100),
    );
  });

  it("non-divisible thirds rescue to one headline line", () => {
    expect(
      headline(
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
          "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
          "1/3 VEST OVER 1 month EVERY 1 month",
        { grant_date: "2025-01-01", grant_quantity: 100 },
      ),
    ).toEqual([{ state: "RESOLVED", amount: 100, date: "2025-02-01" }]);
  });

  it("THEN chain over 48 months", () => {
    expect(
      headline(
        "0.25 VEST OVER 12 months EVERY 1 month THEN 0.75 VEST OVER 36 months EVERY 1 month",
        { grant_date: "2025-01-01", grant_quantity: 48 },
      ),
    ).toEqual(resolved(months(2025, 2, 48), () => 1));
  });

  it("one-year cliff then 36 graded months", () => {
    expect(
      headline("VEST OVER 4 years EVERY 1 month CLIFF 1 year", {
        grant_date: "2025-01-01",
        grant_quantity: 100000,
      }),
    ).toEqual([
      { state: "RESOLVED", amount: 25000, date: "2026-01-01" },
      ...resolved(months(2026, 2, 36), (i) => (i % 3 === 2 ? 2084 : 2083)),
    ]);
  });

  it("pure milestone", () => {
    expect(
      headline("VEST FROM EVENT ipo", {
        grant_date: "2025-01-01",
        grant_quantity: 1000,
        events: { ipo: "2025-06-01" },
      }),
    ).toEqual([{ state: "RESOLVED", amount: 1000, date: "2025-06-01" }]);
  });

  it("dated + pending mix — full UNRESOLVED shape on the pending row", () => {
    expect(
      headline(
        "1/3 VEST FROM EVENT ipo OVER 1 month EVERY 1 month PLUS " +
          "2/3 VEST OVER 1 month EVERY 1 month",
        { grant_date: "2025-01-01", grant_quantity: 100 },
      ),
    ).toEqual([
      { state: "RESOLVED", amount: 66, date: "2025-02-01" },
      {
        state: "UNRESOLVED",
        amount: 34,
        symbolicDate: { type: "UNRESOLVED_VESTING_START" },
      },
    ]);
  });

  it("contingent start — the whole grant rides one UNRESOLVED row", () => {
    expect(
      headline("VEST FROM EVENT ipo OVER 12 months EVERY 1 month", GRANT_2025),
    ).toEqual([
      {
        state: "UNRESOLVED",
        amount: 1200,
        symbolicDate: { type: "UNRESOLVED_VESTING_START" },
      },
    ]);
  });

  it("over-allocating PLUS — both same-date tranches survive", () => {
    expect(
      headline(
        "2/3 VEST OVER 1 month EVERY 1 month PLUS 2/3 VEST OVER 1 month EVERY 1 month",
        { grant_date: "2025-01-01", grant_quantity: 100 },
      ),
    ).toEqual([
      { state: "RESOLVED", amount: 66, date: "2025-02-01" },
      { state: "RESOLVED", amount: 67, date: "2025-02-01" },
    ]);
  });

  it("recovered #43 grids — the rescued 6-tranche headline", () => {
    expect(
      headline(
        "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS " +
          "0.5 VEST FROM DATE 2024-03-01 OVER 4 months EVERY 1 month",
        { grant_date: "2024-01-01", grant_quantity: 800 },
      ),
    ).toEqual([
      { state: "RESOLVED", amount: 100, date: "2024-02-01" },
      { state: "RESOLVED", amount: 100, date: "2024-03-01" },
      { state: "RESOLVED", amount: 200, date: "2024-04-01" },
      { state: "RESOLVED", amount: 200, date: "2024-05-01" },
      { state: "RESOLVED", amount: 100, date: "2024-06-01" },
      { state: "RESOLVED", amount: 100, date: "2024-07-01" },
    ]);
  });

  it("all-void contradiction — IMPOSSIBLE rows carry the claimed total", () => {
    expect(
      headline(
        "VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01 OVER 12 months EVERY 1 month",
        GRANT_2025,
      ),
    ).toEqual([{ state: "IMPOSSIBLE", amount: 1200 }]);
  });

  it("persist/rehydrate projection for a resolved contingent start", () => {
    const persisted = runPersist({
      dsl: "VEST FROM EVENT ipo OVER 12 months EVERY 1 month",
      grant_date: "2025-01-01",
      grant_quantity: 1200,
    });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    const rehydrated = runRehydrate({
      artifact: persisted.artifact,
      grant_quantity: 1200,
      events: { ipo: "2025-06-01" },
    });
    expect(rehydrated.ok).toBe(true);
    if (!rehydrated.ok) return;
    expect(rehydrated.projection).toEqual(
      months(2025, 7, 12).map((date) => ({ date, amount: 100 })),
    );
  });
});
