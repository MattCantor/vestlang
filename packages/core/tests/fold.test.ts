import { describe, it, expect } from "vitest";
import { foldByCliffDate, foldToGrantDate } from "../src/fold";

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
