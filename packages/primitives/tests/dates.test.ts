import { describe, it, expect } from "vitest";
import {
  CONTINGENT_START_SENTINEL,
  addMonthsRule,
  addDays,
  addPeriod,
  advanceCursor,
  daysBetween,
  monthsBetween,
  lt,
  gt,
  eq,
  satisfiesRelation,
} from "../src/dates";

// Day-of-month + overflow cases mirror evaluator/tests/time.addMonths.test.ts,
// adapted to the direct VestingDayOfMonth parameter.
describe("addMonthsRule — 31 / overflow scenarios", () => {
  it("Jan 31 +1mo -> Feb last day (leap year)", () => {
    expect(addMonthsRule("2024-01-31", 1, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });

  it("Non-leap year", () => {
    expect(addMonthsRule("2023-01-31", 1, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2023-02-28",
    );
  });

  it("30 or last -> 29 (leap Feb)", () => {
    expect(addMonthsRule("2024-01-31", 1, "30_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });

  it("29 or last -> 29", () => {
    expect(addMonthsRule("2024-01-31", 1, "29_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });
});

describe("addMonthsRule — VESTING_START_DAY_OR_LAST_DAY_OF_MONTH", () => {
  it("keep original day (31) but clamp to April 30", () => {
    expect(
      addMonthsRule("2024-03-31", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-04-30");
  });

  it("original day 30 -> Feb clamps to 29 (leap)", () => {
    expect(
      addMonthsRule("2024-01-30", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-02-29");
  });

  it("original day 30 -> Feb clamps to 28 (non-leap)", () => {
    expect(
      addMonthsRule("2023-01-30", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2023-02-28");
  });

  it("defaults to VESTING_START_DAY policy when omitted", () => {
    expect(addMonthsRule("2024-03-31", 1)).toBe("2024-04-30");
  });
});

describe("addMonthsRule — origin carries the day-of-month across a clamp", () => {
  // When a chain hands off on a short month the cursor gets clamped (Jan 31 + 1mo
  // is Feb 28). Stepping further from that Feb 28 would normally stick on the 28th.
  // Passing the chain's first date (Jan 31) as the origin tells the stepper which
  // day to aim for, so the schedule springs back to the 31st where it fits.
  it("steps from Feb 28 but lands on Mar 31 when origin is Jan 31", () => {
    expect(
      addMonthsRule(
        "2025-02-28",
        1,
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-03-31");
  });

  it("clamps the origin day to April's last day (30)", () => {
    expect(
      addMonthsRule(
        "2025-02-28",
        2,
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-04-30");
  });

  it("without an origin, the day comes from the date being stepped from", () => {
    // No origin argument: Feb 28 stays the reference, so March holds the 28th.
    expect(
      addMonthsRule("2025-02-28", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2025-03-28");
  });
});

describe("addMonthsRule — fixed numeric day + multi-month", () => {
  it("explicit day 15", () => {
    expect(addMonthsRule("2024-01-31", 1, "15")).toBe("2024-02-15");
  });

  it("leap-day +12mo -> non-leap Feb clamps", () => {
    expect(addMonthsRule("2024-02-29", 12, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2025-02-28",
    );
  });

  it("skip Feb by +2 and land on Mar 31", () => {
    expect(addMonthsRule("2024-01-31", 2, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-03-31",
    );
  });

  it("+13 months to non-leap Feb clamps to 28", () => {
    expect(addMonthsRule("2024-01-31", 13, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2025-02-28",
    );
  });
});

// AC#4 — pin each of the four named policies' output through pickDay (via
// addMonthsRule), and a numeric day, against the same Jan-31 + 1mo step into a
// short month. After the union split, pickDay narrows the numeric branch off and
// switches exhaustively over the named policies; these cases lock the resolved
// day each branch produces so a future refactor can't quietly cross the wires.
describe("addMonthsRule — pickDay per day-of-month policy", () => {
  // Jan 31 + 1mo lands in February, the month that forces every policy's clamp.
  it("29_OR_LAST clamps to Feb 28 (non-leap)", () => {
    expect(addMonthsRule("2023-01-31", 1, "29_OR_LAST_DAY_OF_MONTH")).toBe(
      "2023-02-28",
    );
  });

  it("29_OR_LAST resolves to Feb 29 (leap)", () => {
    expect(addMonthsRule("2024-01-31", 1, "29_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });

  it("30_OR_LAST clamps to the month end below 30", () => {
    expect(addMonthsRule("2023-01-31", 1, "30_OR_LAST_DAY_OF_MONTH")).toBe(
      "2023-02-28",
    );
  });

  it("31_OR_LAST clamps to the month end below 31", () => {
    expect(addMonthsRule("2024-01-31", 1, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-02-29",
    );
  });

  it("VESTING_START tracks the origin's day, clamped to month end", () => {
    // Default origin: the date being stepped from. Jan 31's day-of-month (31)
    // clamps onto February.
    expect(
      addMonthsRule("2024-01-31", 1, "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-02-29");
    // Explicit origin: the day comes from Jan 31 even when stepping from a
    // clamped Feb 28 (see the origin tests below for the full story).
    expect(
      addMonthsRule(
        "2025-02-28",
        1,
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-03-31");
  });

  it("a numeric day picks itself, with the clamp a provable no-op (≤28)", () => {
    expect(addMonthsRule("2023-01-31", 1, "28")).toBe("2023-02-28");
    expect(addMonthsRule("2024-01-31", 1, "15")).toBe("2024-02-15");
    expect(addMonthsRule("2024-01-31", 1, "01")).toBe("2024-02-01");
  });
});

describe("addDays — UTC-pure across DST boundaries", () => {
  it("simple step", () => {
    expect(addDays("2024-01-10", 5)).toBe("2024-01-15");
  });

  it("spans the spring-forward transition", () => {
    expect(addDays("2024-02-26", 14)).toBe("2024-03-11");
  });

  it("spans the fall-back transition", () => {
    expect(addDays("2024-10-27", 14)).toBe("2024-11-10");
  });

  it("large step over leap day and DST", () => {
    expect(addDays("2024-01-01", 84)).toBe("2024-03-25");
  });
});

describe("addPeriod", () => {
  it("DAYS", () => {
    expect(addPeriod("2024-01-01", 10, "DAYS")).toBe("2024-01-11");
  });

  it("MONTHS honors the day-of-month policy", () => {
    expect(
      addPeriod("2024-01-31", 1, "MONTHS", "31_OR_LAST_DAY_OF_MONTH"),
    ).toBe("2024-02-29");
  });

  it("YEARS = months × 12 (with day-of-month clamping)", () => {
    expect(addPeriod("2024-02-29", 1, "YEARS")).toBe("2025-02-28");
    expect(addPeriod("2024-01-15", 2, "YEARS")).toBe("2026-01-15");
  });

  it("forwards the origin to the month stepper", () => {
    expect(
      addPeriod(
        "2025-02-28",
        1,
        "MONTHS",
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-03-31");
  });
});

describe("advanceCursor — origin forwarding", () => {
  // advanceCursor steps a whole segment (occurrences × period) and hands the
  // origin straight through. A 1-occurrence monthly segment from Feb 28 with the
  // chain origin on Jan 31 ends on Mar 31, not Mar 28.
  it("carries the chain origin through a segment hop", () => {
    expect(
      advanceCursor(
        "2025-02-28",
        1,
        1,
        "MONTHS",
        "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
        "2025-01-31",
      ),
    ).toBe("2025-03-31");
  });

  it("defaults the origin to the anchor when omitted", () => {
    expect(advanceCursor("2025-02-28", 1, 1, "MONTHS")).toBe("2025-03-28");
  });
});

describe("year range — sub-100 preserved, out-of-range rejected", () => {
  // The month path used to rebuild dates via Date.UTC(year, …), which remaps
  // years 0–99 to 1900–1999. Component-based building keeps the year verbatim.
  it("sub-100 year is not shifted by ~+1900 in the month path", () => {
    expect(addMonthsRule("0050-06-15", 1)).toBe("0050-07-15");
    expect(addPeriod("0050-01-15", 1, "MONTHS")).toBe("0050-02-15");
  });

  it("sub-100 year survives the day path too", () => {
    expect(addDays("0050-06-15", 1)).toBe("0050-06-16");
  });

  it("rejects arithmetic that overflows past year 9999", () => {
    expect(() => addPeriod("9999-12-31", 1, "YEARS")).toThrow(/range/);
    expect(() => addMonthsRule("9999-12-15", 1)).toThrow(/range/);
  });

  it("rejects arithmetic that underflows before year 0001", () => {
    expect(() => addPeriod("0001-01-01", 1, "YEARS")).not.toThrow(); // 0002 is fine
    expect(() => addMonthsRule("0001-01-15", -12)).toThrow(/range/);
  });

  // A large day step can push the Date past its ±8.64e15 ms limit, at which point
  // every UTC getter returns NaN. Without an explicit NaN check, the year-range
  // comparison (every test against NaN is false) would let it through and emit
  // "0NaN-NaN-NaN"; it must hit the same range error the in-bounds checks raise.
  it("rejects a day step large enough to overflow the Date range", () => {
    expect(() => addDays("2025-01-01", 300_000_000)).toThrow(/range/);
    expect(() => addPeriod("2025-01-01", 300_000_000, "DAYS")).toThrow(/range/);
    expect(() => addDays("2025-01-01", Number.MAX_SAFE_INTEGER)).toThrow(
      /range/,
    );
  });

  it("never returns a malformed NaN-laden date string", () => {
    expect(() => addDays("2025-01-01", 1e17)).toThrow(/range/);
    // The classic symptom of the overflow was a "0NaN-NaN-NaN" result; the
    // clean range error must never carry "NaN" through to the caller.
    try {
      addDays("2025-01-01", 300_000_000);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/NaN/);
    }
  });
});

describe("comparisons on ISO dates", () => {
  it("lt / gt / eq", () => {
    expect(lt("2024-01-01", "2024-01-02")).toBe(true);
    expect(gt("2024-01-02", "2024-01-01")).toBe(true);
    expect(eq("2024-01-02", "2024-01-02")).toBe(true);
    expect(lt("2024-01-02", "2024-01-01")).toBe(false);
  });
});

describe("satisfiesRelation — per-edge BEFORE/AFTER admissibility", () => {
  const before = "2025-01-01";
  const same = "2025-06-01";
  const after = "2025-12-31";
  const base = same; // subject is compared against this

  describe("BEFORE", () => {
    it("non-strict admits earlier and the boundary, rejects later", () => {
      expect(satisfiesRelation("BEFORE", false, before, base)).toBe(true);
      expect(satisfiesRelation("BEFORE", false, same, base)).toBe(true); // boundary
      expect(satisfiesRelation("BEFORE", false, after, base)).toBe(false);
    });

    it("strict rejects the boundary day", () => {
      expect(satisfiesRelation("BEFORE", true, before, base)).toBe(true);
      expect(satisfiesRelation("BEFORE", true, same, base)).toBe(false); // boundary
      expect(satisfiesRelation("BEFORE", true, after, base)).toBe(false);
    });
  });

  describe("AFTER", () => {
    it("non-strict admits later and the boundary, rejects earlier", () => {
      expect(satisfiesRelation("AFTER", false, after, base)).toBe(true);
      expect(satisfiesRelation("AFTER", false, same, base)).toBe(true); // boundary
      expect(satisfiesRelation("AFTER", false, before, base)).toBe(false);
    });

    it("strict rejects the boundary day", () => {
      expect(satisfiesRelation("AFTER", true, after, base)).toBe(true);
      expect(satisfiesRelation("AFTER", true, same, base)).toBe(false); // boundary
      expect(satisfiesRelation("AFTER", true, before, base)).toBe(false);
    });
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days, signed by direction", () => {
    expect(daysBetween("2024-01-01", "2024-01-15")).toBe(14);
    expect(daysBetween("2024-01-15", "2024-01-01")).toBe(-14);
    expect(daysBetween("2024-01-10", "2024-01-10")).toBe(0);
  });

  // Both endpoints are UTC midnights, so a span crossing a DST transition is
  // still an exact day count (no partial-day to round off).
  it("is exact across a DST boundary and a leap day", () => {
    expect(daysBetween("2024-02-26", "2024-03-11")).toBe(14); // spring-forward
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2); // leap day between
  });
});

describe("monthsBetween", () => {
  // The defining property: monthsBetween inverts addPeriod(…, MONTHS) under the
  // default day-of-month rule, exactly, both directions. Whatever clamp policy
  // the month stepper uses, this loop pins the inverse to match it — so a change
  // to one without the other fails here, in core, where the arithmetic lives.
  it("inverts addPeriod(MONTHS) exactly: k months → k rem 0", () => {
    const anchors = [
      "2025-01-31", // Jan-31: every monthly landing clamps in short months
      "2024-02-29", // leap-day anchor
      "2024-01-31", // Jan-31 in a leap year
      "2025-01-15", // ordinary mid-month day
      "2025-01-30", // Jan-30: clamps in Feb but not elsewhere
      "2025-04-30", // Apr-30: a 30-day month-end
    ] as const;
    for (const anchor of anchors) {
      for (let k = 0; k <= 24; k++) {
        const forward = addPeriod(anchor, k, "MONTHS");
        expect(monthsBetween(anchor, forward)).toEqual({
          diff: k,
          remainderDays: 0,
        });
      }
      // Reverse from k=1 (k=0 would assert -0, which toEqual treats as distinct
      // from the +0 diff returns).
      for (let k = 1; k <= 24; k++) {
        const backward = addPeriod(anchor, -k, "MONTHS");
        expect(monthsBetween(anchor, backward)).toEqual({
          diff: -k,
          remainderDays: 0,
        });
      }
    }
  });

  // AC3 — a month-end-clamped endpoint counts as a full month. The forward count
  // compares `to` against from's day clamped to the target month's length, so
  // landing on the clamped day (Feb's last) reads a complete month.
  it("credits a forward month-end clamp as a full month", () => {
    expect(monthsBetween("2024-01-31", "2024-02-29").diff).toBe(1); // leap
    expect(monthsBetween("2023-01-31", "2023-02-28").diff).toBe(1); // non-leap
  });

  // AC4 — signed and, near a clamp, deliberately asymmetric.
  describe("signed direction, asymmetric at the clamp", () => {
    it("returns a negative diff for a backward whole-month span", () => {
      expect(monthsBetween("2025-04-15", "2025-01-15").diff).toBe(-3);
    });

    it("is sign-symmetric when no endpoint hits a clamp (day ≤ 28)", () => {
      expect(monthsBetween("2025-01-15", "2025-04-15").diff).toBe(3);
      expect(monthsBetween("2025-04-15", "2025-01-15").diff).toBe(-3);
    });

    it("is asymmetric across a clamp pair", () => {
      // Forward, the Feb-29 landing counts as a whole month from Jan 31.
      expect(monthsBetween("2024-01-31", "2024-02-29")).toEqual({
        diff: 1,
        remainderDays: 0,
      });
      // Backward, no clamp applies (Jan 31 is a real day of January), so Feb 29
      // → Jan 31 is short of a whole month: 0 months, 29 days back.
      expect(monthsBetween("2024-02-29", "2024-01-31")).toEqual({
        diff: 0,
        remainderDays: -29,
      });
    });
  });

  // AC5 — remainder days carry the direction's sign.
  describe("remainder days, signed", () => {
    it("forward non-whole span", () => {
      expect(monthsBetween("2024-01-15", "2024-02-20")).toEqual({
        diff: 1,
        remainderDays: 5,
      });
    });

    it("backward non-whole span", () => {
      expect(monthsBetween("2025-01-15", "2024-12-10")).toEqual({
        diff: -1,
        remainderDays: -5,
      });
    });
  });

  it("is zero months, zero days for the same date", () => {
    expect(monthsBetween("2025-01-15", "2025-01-15")).toEqual({
      diff: 0,
      remainderDays: 0,
    });
  });

  // The forward branch that decrements the month count when `to` falls short of
  // `from`'s clamped day was entirely uncovered — every case above either landed
  // exactly on a month boundary or had `to`'s day ≥ `from`'s. A whole month from
  // Jan 31 is Feb 29 (the clamp), so Feb 10 is short of one month: 0 months and
  // 10 days, not 1 month with a negative remainder.
  it("forward partial month under a month-end clamp: Jan 31 → Feb 10 is 0 months, 10 days", () => {
    expect(monthsBetween("2024-01-31", "2024-02-10")).toEqual({
      diff: 0,
      remainderDays: 10,
    });
  });
});

// The pickDay policy cases above all step into February, where 29/30/31_OR_LAST
// collapse onto the same month-end and can't be told apart. These step into
// longer months, where each policy resolves to a distinct day — pinning that
// 29_OR_LAST really means 29 (not the 30/31 fall-through) and 30_OR_LAST means 30.
describe("addMonthsRule — pickDay policies are distinct outside a short month", () => {
  it("29_OR_LAST resolves to 29 in a 30-day month (not 30)", () => {
    // Mar 31 + 1mo → April (30 days): 29_OR_LAST picks 29; the 30_OR_LAST
    // fall-through would pick 30.
    expect(addMonthsRule("2024-03-31", 1, "29_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-04-29",
    );
  });

  it("30_OR_LAST resolves to 30 in a 31-day month (not 31)", () => {
    // Jan 31 + 2mo → March (31 days): 30_OR_LAST picks 30; the 31_OR_LAST
    // fall-through would pick 31.
    expect(addMonthsRule("2024-01-31", 2, "30_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-03-30",
    );
  });

  it("31_OR_LAST resolves to the full 31 in a 31-day month", () => {
    expect(addMonthsRule("2024-01-31", 2, "31_OR_LAST_DAY_OF_MONTH")).toBe(
      "2024-03-31",
    );
  });
});

// advanceCursor steps occurrences × period units. The existing cases use 1 × 1,
// where × and ÷ coincide, so they don't pin the operator. This steps 4 × 3 = 12
// months; a ÷ would step 1 (4/3 truncated) and land 11 months early.
describe("advanceCursor — span is the product occurrences × period", () => {
  it("4 occurrences × 3-month period steps a full 12 months", () => {
    expect(advanceCursor("2024-01-15", 4, 3, "MONTHS")).toBe("2025-01-15");
  });
});

// The rejection side of the 0001–9999 range (year 0000 / past 9999) is covered
// in the "year range" block above; these pin the acceptance side — a date sitting
// exactly on each endpoint round-trips instead of being rejected. 9999-12-31 is
// also the contingent-start sentinel, so it must stay representable.
describe("year range — the 0001 and 9999 endpoints are representable", () => {
  it("accepts a date in year 0001 (range floor)", () => {
    expect(addDays("0001-01-01", 5)).toBe("0001-01-06");
  });

  it("accepts 9999-12-31 (range ceiling, the sentinel date)", () => {
    expect(addDays("9999-12-30", 1)).toBe("9999-12-31");
  });
});

describe("CONTINGENT_START_SENTINEL", () => {
  it("is the last representable calendar date, 9999-12-31", () => {
    // Load-bearing: the compiler recognizes a contingent start by this exact
    // value, and it must be a real-but-unsteppable date (year 9999 overflows the
    // date math), so a silent change here would break contingent-start storage.
    expect(CONTINGENT_START_SENTINEL).toBe("9999-12-31");
  });
});
