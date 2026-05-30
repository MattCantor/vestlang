import { describe, it, expect } from "vitest";
import { foldByCliffDate, foldToGrantDate } from "../src/fold";

const id = (x: { date: string; amount: number }) => x;

describe("foldByCliffDate", () => {
  it("aggregates pre-cliff amounts onto the cliff date when it lands on a boundary", () => {
    const dates = ["2024-01-01", "2024-02-01", "2024-03-01", "2024-04-01"];
    const amounts = [10, 10, 10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-03-01", id);
    expect(out).toEqual([
      { date: "2024-03-01", amount: 30 }, // Jan+Feb+Mar collapse onto the cliff
      { date: "2024-04-01", amount: 10 },
    ]);
  });

  it("flushes the aggregate onto an off-grid cliff between two dates", () => {
    const dates = ["2024-01-01", "2024-02-01", "2024-04-01"];
    const amounts = [10, 10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-03-15", id);
    expect(out).toEqual([
      { date: "2024-03-15", amount: 20 }, // Jan+Feb flushed onto the off-grid cliff
      { date: "2024-04-01", amount: 10 },
    ]);
  });

  it("emits the aggregate on the cliff date when the whole run precedes it", () => {
    const dates = ["2024-01-01", "2024-02-01"];
    const amounts = [10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-06-01", id);
    expect(out).toEqual([{ date: "2024-06-01", amount: 20 }]);
  });

  it("passes amounts through unchanged when all dates are at/after the cliff", () => {
    const dates = ["2024-03-01", "2024-04-01"];
    const amounts = [10, 10];
    const out = foldByCliffDate(dates, amounts, "2024-01-01", id);
    expect(out).toEqual([
      { date: "2024-03-01", amount: 10 },
      { date: "2024-04-01", amount: 10 },
    ]);
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
