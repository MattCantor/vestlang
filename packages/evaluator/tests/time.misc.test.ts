import { describe, it, expect } from "vitest";
import { OCTDate } from "@vestlang/types";
import { addDays, eq, gt, lt } from "../src/evaluate/time";

describe("time helpers", () => {
  it("addDay simple", () => {
    expect(addDays("2024-01-10", 5)).toBe("2024-01-15");
  });

  // Regression for issue #3: addDays must be UTC-pure. A local-time stepper
  // drops a day when the span crosses a DST transition (these dates straddle the
  // March/November US transitions), which previously corrupted DAYS schedules
  // on non-UTC machines. These assert the calendar-correct result, which is
  // timezone-independent.
  it("addDays is UTC-pure across DST boundaries", () => {
    // spring-forward (2024-03-10): Feb 26 + 14 calendar days = Mar 11
    expect(addDays("2024-02-26", 14)).toBe("2024-03-11");
    // fall-back (2024-11-03): Oct 27 + 14 = Nov 10
    expect(addDays("2024-10-27", 14)).toBe("2024-11-10");
    // a single large step over both leap day and DST stays consistent with
    // stepping in smaller increments
    expect(addDays("2024-01-01", 84)).toBe("2024-03-25");
  });

  it("addDays yields exact 14-day grid across DST", () => {
    const start = "2023-12-18" as OCTDate;
    expect(addDays(start, 14 * 7)).toBe("2024-03-25");
    expect(addDays(start, 14 * 8)).toBe("2024-04-08");
  });

  it("lt/gt/eq correctness", () => {
    expect(lt("2024-01-01", "2024-01-02")).toBe(true);
    expect(gt("2024-01-02", "2024-01-01")).toBe(true);
    expect(eq("2024-01-02", "2024-01-02")).toBe(true);
  });
});
