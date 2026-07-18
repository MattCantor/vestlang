import { describe, it, expect } from "vitest";
import type { Installment } from "@vestlang/types";
import {
  foldByCliffDate,
  foldToGrantDate,
  foldSameDateInstallments,
} from "../src/fold";

const sumAmounts = (xs: Installment[]): number =>
  xs.reduce((a, x) => a + x.amount, 0);

describe("foldByCliffDate", () => {
  it("aggregates pre-cliff amounts onto the cliff date when it lands on a boundary", () => {
    const dates = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"];
    const amounts = [10, 10, 10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-03-01");
    expect(out).toEqual([
      { date: "2024-03-01", amount: 30 }, // Jan+Feb+Mar collapse onto the cliff
      { date: "2024-04-01", amount: 10 },
    ]);
  });

  it("flushes the aggregate onto an off-grid cliff between two dates", () => {
    const dates = ["2024-01-01", "2024-02-01", "2024-04-01"];
    const amounts = [10, 10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-03-15");
    expect(out).toEqual([
      { date: "2024-03-15", amount: 20 }, // Jan+Feb flushed onto the off-grid cliff
      { date: "2024-04-01", amount: 10 },
    ]);
  });

  it("emits the aggregate on the cliff date when the whole run precedes it", () => {
    const dates = ["2024-01-01", "2024-02-01"];
    const amounts = [10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-06-01");
    expect(out).toEqual([{ date: "2024-06-01", amount: 20 }]);
  });

  it("passes amounts through unchanged when all dates are at/after the cliff", () => {
    const dates = ["2024-03-01", "2024-04-01"];
    const amounts = [10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-01-01");
    expect(out).toEqual([
      { date: "2024-03-01", amount: 10 },
      { date: "2024-04-01", amount: 10 },
    ]);
  });

  it("does not re-emit the aggregate for a second entry on the cliff date", () => {
    // Two installments land exactly on the cliff (e.g. from two statements).
    // Each emits only its own amount — the first does not get re-added.
    const dates = ["2024-03-01", "2024-03-01"];
    const amounts = [10, 20];
    const out = foldByCliffDate(dates, amounts, "2024-03-01");
    expect(out).toEqual([
      { date: "2024-03-01", amount: 10 },
      { date: "2024-03-01", amount: 20 },
    ]);
  });

  it("aggregates pre-cliff amounts onto the first cliff-date entry only", () => {
    const dates = ["2024-02-01", "2024-03-01", "2024-03-01"];
    const amounts = [10, 20, 30];
    const out = foldByCliffDate(dates, amounts, "2024-03-01");
    expect(out).toEqual([
      { date: "2024-03-01", amount: 30 }, // Feb (10) collapses onto the first cliff entry (20)
      { date: "2024-03-01", amount: 30 }, // the second cliff entry stands alone
    ]);
  });

  it("flushes once when duplicate dates straddle an off-grid cliff", () => {
    // The off-grid flush spends the aggregate; the duplicate post-cliff dates
    // pass through without re-flushing.
    const dates = ["2024-01-01", "2024-02-01", "2024-04-01", "2024-04-01"];
    const amounts = [10, 10, 5, 7];
    const out = foldByCliffDate(dates, amounts, "2024-03-15");
    expect(out).toEqual([
      { date: "2024-03-15", amount: 20 }, // Jan+Feb flushed onto the off-grid cliff
      { date: "2024-04-01", amount: 5 },
      { date: "2024-04-01", amount: 7 },
    ]);
  });

  it("preserves the input sum across duplicate cliff-date entries", () => {
    const dates = ["2024-02-01", "2024-03-01", "2024-03-01", "2024-04-01"];
    const amounts = [10, 20, 30, 40];
    const out = foldByCliffDate(dates, amounts, "2024-03-01");
    const total = out.reduce((a, e) => a + e.amount, 0);
    expect(total).toBe(100);
  });
});

describe("foldToGrantDate", () => {
  it("rewrites the parallel series, folding pre-grant amounts onto the grant date", () => {
    const { dates, amounts } = foldToGrantDate(
      ["2023-12-01", "2024-01-01", "2024-02-01"],
      [5, 10, 10],
      "2024-01-01",
    );
    expect(dates).toEqual(["2024-01-01", "2024-02-01"]);
    expect(amounts).toEqual([15, 10]); // pre-grant 5 merges into the grant-date 10
  });
});

describe("foldSameDateInstallments", () => {
  // A mixed stream: same-date RESOLVED duplicates (a later one appearing after a
  // symbolic row), plus an UNRESOLVED and an IMPOSSIBLE row to leave in place.
  const mixed: Installment[] = [
    { state: "RESOLVED", amount: 8, date: "2025-02-01" },
    { state: "RESOLVED", amount: 8, date: "2025-02-01" },
    { state: "RESOLVED", amount: 9, date: "2025-03-01" },
    {
      state: "UNRESOLVED",
      amount: 50,
      symbolicDate: { type: "UNRESOLVED_VESTING_START" },
    },
    { state: "RESOLVED", amount: 8, date: "2025-03-01" },
    { state: "IMPOSSIBLE", amount: 5 },
    { state: "RESOLVED", amount: 3, date: "2025-04-01" },
  ];

  it("merges same-date RESOLVED rows into one and passes symbolic rows through in place", () => {
    // The 2025-03-01 duplicate that trails the UNRESOLVED row still merges up into
    // the first-seen 2025-03-01 (9 + 8 = 17); the symbolic rows keep their slots.
    expect(foldSameDateInstallments(mixed)).toEqual([
      { state: "RESOLVED", amount: 16, date: "2025-02-01" },
      { state: "RESOLVED", amount: 17, date: "2025-03-01" },
      {
        state: "UNRESOLVED",
        amount: 50,
        symbolicDate: { type: "UNRESOLVED_VESTING_START" },
      },
      { state: "IMPOSSIBLE", amount: 5 },
      { state: "RESOLVED", amount: 3, date: "2025-04-01" },
    ]);
  });

  it("conserves the stream total", () => {
    expect(sumAmounts(foldSameDateInstallments(mixed))).toBe(sumAmounts(mixed));
  });

  it("does not mutate the input array or its installments", () => {
    const before = structuredClone(mixed);
    foldSameDateInstallments(mixed);
    expect(mixed).toEqual(before);
  });

  it("is a no-op on an already one-per-date stream", () => {
    const distinct: Installment[] = [
      { state: "RESOLVED", amount: 10, date: "2025-02-01" },
      { state: "RESOLVED", amount: 10, date: "2025-03-01" },
    ];
    expect(foldSameDateInstallments(distinct)).toEqual(distinct);
  });
});
