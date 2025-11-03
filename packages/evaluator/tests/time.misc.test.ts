import { describe, it, expect } from "vitest";
import { OCTDate } from "@vestlang/types";
import { baseCtx } from "./helpers";
import { addDays, eq, gt, lt, nextDate } from "../src/evaluate/time";

describe("time helpers", () => {
  it("nextDate uses DAYS", () => {
    const d = nextDate("2024-01-01" as OCTDate, "DAYS", 10, baseCtx());
    expect(d).toBe("2024-01-11" as OCTDate);
  });

  it("addDay simple", () => {
    expect(addDays("2024-01-10" as OCTDate, 5)).toBe("2024-01-15" as OCTDate);
  });

  it("lt/gt/eq correctness", () => {
    expect(lt("2024-01-01" as OCTDate, "2024-01-02" as OCTDate)).toBe(true);
    expect(gt("2024-01-02" as OCTDate, "2024-01-01" as OCTDate)).toBe(true);
    expect(eq("2024-01-02" as OCTDate, "2024-01-02" as OCTDate)).toBe(true);
  });
});
