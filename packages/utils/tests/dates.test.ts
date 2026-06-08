import { describe, it, expect } from "vitest";
import { isValidCalendarDate, todayISO } from "../src/dates";

describe("isValidCalendarDate", () => {
  it("accepts real dates, including the leap day", () => {
    for (const s of ["2025-01-31", "2024-02-29", "2025-12-31", "0001-01-01"]) {
      expect(isValidCalendarDate(s)).toBe(true);
    }
  });

  it("rejects impossible days", () => {
    expect(isValidCalendarDate("2025-02-31")).toBe(false);
    expect(isValidCalendarDate("2023-02-29")).toBe(false); // non-leap Feb 29
    expect(isValidCalendarDate("2025-04-31")).toBe(false); // April has 30
    expect(isValidCalendarDate("2025-01-00")).toBe(false);
  });

  it("rejects out-of-range months and years", () => {
    expect(isValidCalendarDate("2025-13-01")).toBe(false);
    expect(isValidCalendarDate("2025-00-15")).toBe(false);
    expect(isValidCalendarDate("0000-01-01")).toBe(false);
  });

  it("rejects anything that isn't strict YYYY-MM-DD", () => {
    for (const s of [
      "2025-1-1",
      "25-01-01",
      "2025/01/01",
      "2025-01-01T00:00:00Z",
      "",
      "garbage",
    ]) {
      expect(isValidCalendarDate(s)).toBe(false);
    }
  });

  it("applies the centennial leap rule", () => {
    expect(isValidCalendarDate("2000-02-29")).toBe(true); // div by 400
    expect(isValidCalendarDate("1900-02-29")).toBe(false); // div by 100, not 400
  });
});

describe("todayISO", () => {
  // Can't pin an exact value without freezing the clock; assert the shape and
  // that it's a date the rest of the system would accept.
  it("returns a strict YYYY-MM-DD string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns a real calendar date", () => {
    expect(isValidCalendarDate(todayISO())).toBe(true);
  });
});
