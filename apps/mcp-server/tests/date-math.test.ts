import { describe, it, expect } from "vitest";
import type { OCTDate } from "@vestlang/types";
import {
  addPeriod,
  dateDiff,
  resolveOffset,
  resolveVestingDay,
} from "../src/date-math.js";

describe("addPeriod", () => {
  it("adds months with day clamping (leap year)", () => {
    const r = addPeriod(
      "2024-01-31" as OCTDate,
      1,
      "months",
      "31_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2024-02-29");
  });

  it("adds months with day clamping (non-leap year)", () => {
    const r = addPeriod(
      "2023-01-31" as OCTDate,
      1,
      "months",
      "31_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2023-02-28");
  });

  it("adds years", () => {
    const r = addPeriod(
      "2025-01-15" as OCTDate,
      4,
      "years",
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2029-01-15");
  });

  it("adds weeks as 7 × days", () => {
    const r = addPeriod(
      "2025-01-01" as OCTDate,
      2,
      "weeks",
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2025-01-15");
  });

  it("subtracts via negative length", () => {
    const r = addPeriod(
      "2025-06-15" as OCTDate,
      -3,
      "months",
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
    expect(r).toBe("2025-03-15");
  });
});

describe("dateDiff", () => {
  it("counts whole days", () => {
    expect(
      dateDiff("2025-01-01" as OCTDate, "2025-01-31" as OCTDate, "days"),
    ).toEqual({ diff: 30 });
  });

  it("is signed — negative when to < from", () => {
    expect(
      dateDiff("2025-01-31" as OCTDate, "2025-01-01" as OCTDate, "days"),
    ).toEqual({ diff: -30 });
  });

  it("counts whole calendar months with remainder_days", () => {
    const r = dateDiff(
      "2025-01-15" as OCTDate,
      "2025-04-20" as OCTDate,
      "months",
    );
    expect(r.diff).toBe(3);
    expect(r.remainder_days).toBe(5);
  });

  it("decrements month count when day hasn't reached from.day", () => {
    const r = dateDiff(
      "2025-01-31" as OCTDate,
      "2025-02-15" as OCTDate,
      "months",
    );
    expect(r.diff).toBe(0);
    expect(r.remainder_days).toBeGreaterThan(0);
  });

  it("same date is zero months, zero days", () => {
    const r = dateDiff(
      "2025-01-15" as OCTDate,
      "2025-01-15" as OCTDate,
      "months",
    );
    expect(r.diff).toBe(0);
    expect(r.remainder_days).toBe(0);
  });
});

describe("resolveOffset", () => {
  it("resolves a simple DATE + months expression", () => {
    const r = resolveOffset({
      expr: "DATE 2025-01-01 + 6 months",
      grant_date: "2025-01-01" as OCTDate,
    });
    expect(r).toEqual({ ok: true, date: "2025-07-01" });
  });

  it("resolves an EVENT + months expression with events map", () => {
    const r = resolveOffset({
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01" as OCTDate,
      events: { ipo: "2027-06-01" as OCTDate },
    });
    expect(r).toEqual({ ok: true, date: "2027-12-01" });
  });

  it("returns unresolved when the event is missing from events map", () => {
    const r = resolveOffset({
      expr: "EVENT ipo + 6 months",
      grant_date: "2025-01-01" as OCTDate,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unresolved/i);
  });

  it("resolves a pure offset (+N months) relative to grant_date", () => {
    const r = resolveOffset({
      expr: "+3 months",
      grant_date: "2025-01-01" as OCTDate,
    });
    expect(r).toEqual({ ok: true, date: "2025-04-01" });
  });

  it("surfaces parse errors", () => {
    const r = resolveOffset({
      expr: "this is not vestlang",
      grant_date: "2025-01-01" as OCTDate,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/parse/i);
  });
});

describe("resolveVestingDay", () => {
  it("clamps Feb under 29_OR_LAST_DAY_OF_MONTH (non-leap)", () => {
    expect(
      resolveVestingDay("2026-02-15" as OCTDate, "29_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2026-02-28");
  });

  it("clamps Feb under 31_OR_LAST_DAY_OF_MONTH (leap)", () => {
    expect(
      resolveVestingDay("2024-02-15" as OCTDate, "31_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-02-29");
  });

  it("returns day 15 for numeric rule '15' regardless of input day", () => {
    expect(resolveVestingDay("2025-03-07" as OCTDate, "15")).toBe("2025-03-15");
  });

  it("preserves input day under VESTING_START_DAY rule when in range", () => {
    expect(
      resolveVestingDay(
        "2025-03-20" as OCTDate,
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
      ),
    ).toBe("2025-03-20");
  });
});
