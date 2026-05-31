import { describe, it, expect } from "vitest";
import { compile, compileToInstallments } from "../src/compile";
import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/types";

// Conformance suite ported from OCF-Tools' vesting_compiler/__tests__/compile.test.ts
// (the reference for the canonical-IR semantics). `compileVesting` → `compile`.

const sumAmounts = (events: { amount: string }[]): number =>
  events.reduce((acc, e) => acc + Number(e.amount), 0);

const DATE_BASE = { type: "DATE" as const };
const startJan2025: VestingRuntime = { startDate: "2025-01-01" };

describe("compile — standard 4yr/1mo with 25% cliff", () => {
  const template: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        vesting_base: DATE_BASE,
        occurrences: 48,
        period: 1,
        period_type: "MONTHS",
        cliff: { length: 12, period_type: "MONTHS", percentage: { numerator: 1, denominator: 4 } },
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  };

  it("emits 37 events: 1 cliff + 36 post-cliff", () => {
    expect(compile(template, 100_000, startJan2025)).toHaveLength(37);
  });

  it("first event is the cliff at month 12 vesting 25000", () => {
    expect(compile(template, 100_000, startJan2025)[0]).toEqual({
      date: "2026-01-01",
      amount: "25000",
    });
  });

  it("last event lands at start + 48 months", () => {
    const events = compile(template, 100_000, startJan2025);
    expect(events[events.length - 1].date).toBe("2029-01-01");
  });

  it("sum equals totalShares exactly", () => {
    expect(sumAmounts(compile(template, 100_000, startJan2025))).toBe(100_000);
  });

  it("absorbs rounding drift with an awkward share count", () => {
    expect(sumAmounts(compile(template, 100, startJan2025))).toBe(100);
  });

  it("emits exactly one share at the final event when totalShares = 1", () => {
    const events = compile(template, 1, startJan2025);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ date: "2029-01-01", amount: "1" });
  });
});

describe("compile — non-standard 30% cliff", () => {
  const template: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        vesting_base: DATE_BASE,
        occurrences: 48,
        period: 1,
        period_type: "MONTHS",
        cliff: { length: 12, period_type: "MONTHS", percentage: { numerator: 3, denominator: 10 } },
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  };

  it("cliff event vests 30000 (30% of 100000)", () => {
    expect(compile(template, 100_000, startJan2025)[0]).toEqual({
      date: "2026-01-01",
      amount: "30000",
    });
  });

  it("emits 37 events with sum equal to totalShares", () => {
    const events = compile(template, 100_000, startJan2025);
    expect(events).toHaveLength(37);
    expect(sumAmounts(events)).toBe(100_000);
  });
});

describe("compile — bespoke 5/15/40/40 chained over 4 years", () => {
  const mkYear = (order: number, num: number): VestingScheduleTemplate["statements"][number] => ({
    order,
    vesting_base: DATE_BASE,
    occurrences: 1,
    period: 12,
    period_type: "MONTHS",
    percentage: { numerator: num, denominator: 20 },
  });
  const template: VestingScheduleTemplate = {
    id: "t1",
    statements: [mkYear(1, 1), mkYear(2, 3), mkYear(3, 8), mkYear(4, 8)],
  };

  it("emits 4 yearly events with chained dates and 5/15/40/40 split", () => {
    expect(compile(template, 100_000, startJan2025)).toEqual([
      { date: "2026-01-01", amount: "5000" },
      { date: "2027-01-01", amount: "15000" },
      { date: "2028-01-01", amount: "40000" },
      { date: "2029-01-01", amount: "40000" },
    ]);
  });
});

describe("compile — additional DATE-anchored cases", () => {
  it("plain 4-year monthly with no cliff emits 48 events summing to totalShares", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    const events = compile(template, 100_000, startJan2025);
    expect(events).toHaveLength(48);
    expect(sumAmounts(events)).toBe(100_000);
    expect(events[0].date).toBe("2025-02-01");
    expect(events[events.length - 1].date).toBe("2029-01-01");
  });

  it("cliff at last occurrence (K == N) emits a single event", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 12,
          period: 1,
          period_type: "MONTHS",
          cliff: { length: 12, period_type: "MONTHS", percentage: { numerator: 1, denominator: 1 } },
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    expect(compile(template, 100_000, startJan2025)).toEqual([
      { date: "2026-01-01", amount: "100000" },
    ]);
  });

  it("off-grid cliff lumps on the true cliff date, post-cliff stays on the grid", () => {
    // Monthly-4 from 2025-01-01; cliff 75 DAYS in = 2025-03-17 (between the
    // Mar 1 and Apr 1 grid points). Feb 1 + Mar 1 occurrences subsume into a
    // half-grant lump on the off-grid date; Apr 1 + May 1 split the rest.
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
          cliff: { length: 75, period_type: "DAYS", percentage: { numerator: 1, denominator: 2 } },
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    const events = compile(template, 400, startJan2025);
    expect(events).toEqual([
      { date: "2025-03-17", amount: "200" },
      { date: "2025-04-01", amount: "100" },
      { date: "2025-05-01", amount: "100" },
    ]);
    expect(sumAmounts(events)).toBe(400);
  });

  it("DAYS schedule produces correct ISO dates", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 4,
          period: 7,
          period_type: "DAYS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    const events = compile(template, 400, startJan2025);
    expect(events.map((e) => e.date)).toEqual([
      "2025-01-08",
      "2025-01-15",
      "2025-01-22",
      "2025-01-29",
    ]);
    expect(sumAmounts(events)).toBe(400);
  });

  it("preserves seed day across short months for an end-of-month start", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 6,
          period: 1,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    const events = compile(template, 600, { startDate: "2025-01-31" });
    expect(events.map((e) => e.date)).toEqual([
      "2025-02-28",
      "2025-03-31",
      "2025-04-30",
      "2025-05-31",
      "2025-06-30",
      "2025-07-31",
    ]);
  });

  it("sorts statements by order before processing", () => {
    const ordered: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 1,
          period: 12,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
        },
        {
          order: 2,
          vesting_base: DATE_BASE,
          occurrences: 1,
          period: 12,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
        },
      ],
    };
    const reversed: VestingScheduleTemplate = {
      id: "t1",
      statements: [ordered.statements[1], ordered.statements[0]],
    };
    expect(compile(ordered, 100, startJan2025)).toEqual(
      compile(reversed, 100, startJan2025),
    );
  });

  it("zero-percent statement emits no events but advances the cursor", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 1,
          period: 12,
          period_type: "MONTHS",
          percentage: { numerator: 0, denominator: 1 },
        },
        {
          order: 2,
          vesting_base: DATE_BASE,
          occurrences: 1,
          period: 12,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    expect(compile(template, 100, startJan2025)).toEqual([
      { date: "2027-01-01", amount: "100" },
    ]);
  });

  it("throws when totalShares is not a non-negative integer", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 1,
          period: 12,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    expect(() => compile(template, -1, startJan2025)).toThrow();
    expect(() => compile(template, 1.5, startJan2025)).toThrow();
  });
});

describe("compile — grant_date handling (DATE-anchored)", () => {
  const monthlyNoCliff: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        vesting_base: DATE_BASE,
        occurrences: 48,
        period: 1,
        period_type: "MONTHS",
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  };

  const monthlyWithCliff: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        vesting_base: DATE_BASE,
        occurrences: 48,
        period: 1,
        period_type: "MONTHS",
        cliff: { length: 12, period_type: "MONTHS", percentage: { numerator: 1, denominator: 4 } },
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  };

  it("grant_date before vesting_start has no effect", () => {
    const events = compile(monthlyNoCliff, 4800, {
      startDate: "2025-01-01",
      grantDate: "2023-06-01",
    });
    expect(events).toHaveLength(48);
    expect(events[0].date).toBe("2025-02-01");
    expect(sumAmounts(events)).toBe(4800);
  });

  it("grant_date equal to a scheduled event date merges held amount into that event", () => {
    const events = compile(monthlyNoCliff, 4800, {
      startDate: "2025-01-01",
      grantDate: "2025-04-01",
    });
    expect(events).toHaveLength(46);
    expect(events[0]).toEqual({ date: "2025-04-01", amount: "300" });
    expect(events[1]).toEqual({ date: "2025-05-01", amount: "100" });
    expect(sumAmounts(events)).toBe(4800);
  });

  it("grant_date between scheduled events emits an off-rhythm event on grant_date", () => {
    const events = compile(monthlyNoCliff, 4800, {
      startDate: "2025-01-01",
      grantDate: "2025-03-15",
    });
    expect(events).toHaveLength(47);
    expect(events[0]).toEqual({ date: "2025-03-15", amount: "200" });
    expect(events[1]).toEqual({ date: "2025-04-01", amount: "100" });
    expect(events[events.length - 1].date).toBe("2029-01-01");
    expect(sumAmounts(events)).toBe(4800);
  });

  it("grant_date after explicit cliff absorbs cliff + intervening months", () => {
    const events = compile(monthlyWithCliff, 4800, {
      startDate: "2023-01-01",
      grantDate: "2024-06-01",
    });
    expect(events[0]).toEqual({ date: "2024-06-01", amount: "1700" });
    expect(events[1]).toEqual({ date: "2024-07-01", amount: "100" });
    expect(sumAmounts(events)).toBe(4800);
  });

  it("grant_date after the entire schedule emits the full grant on grant_date", () => {
    const events = compile(monthlyNoCliff, 4800, {
      startDate: "2020-01-01",
      grantDate: "2030-01-01",
    });
    expect(events).toEqual([{ date: "2030-01-01", amount: "4800" }]);
  });

  it("grant_date on the rhythm with a cliff exactly at grant_date", () => {
    const events = compile(monthlyWithCliff, 100_000, {
      startDate: "2025-01-01",
      grantDate: "2026-01-01",
    });
    expect(events).toHaveLength(37);
    expect(events[0]).toEqual({ date: "2026-01-01", amount: "25000" });
    expect(sumAmounts(events)).toBe(100_000);
  });

  it("preserves the held-back-pre-cliff filter under grant_date", () => {
    const events = compile(monthlyWithCliff, 100_000, {
      startDate: "2025-01-01",
      grantDate: "2026-06-01",
    });
    expect(sumAmounts(events)).toBe(100_000);
    for (const e of events) {
      expect(e.date >= "2026-06-01").toBe(true);
    }
  });
});

describe("compile — EVENT-anchored statements", () => {
  it("single-event instantaneous vest of full grant", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    expect(
      compile(template, 100_000, {
        eventFirings: [{ event_id: "ipo", date: "2026-04-01" }],
      }),
    ).toEqual([{ date: "2026-04-01", amount: "100000" }]);
  });

  it("partial firing with realized_fraction scales the vested amount", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "milestone" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    expect(
      compile(template, 100_000, {
        eventFirings: [
          {
            event_id: "milestone",
            date: "2026-04-01",
            realized_fraction: { numerator: 3, denominator: 10 },
          },
        ],
      }),
    ).toEqual([{ date: "2026-04-01", amount: "30000" }]);
  });

  it("post-event monthly schedule (occurrences > 1) vests from firing date", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 12,
          period: 1,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    const events = compile(template, 1200, {
      eventFirings: [{ event_id: "ipo", date: "2026-04-01" }],
    });
    expect(events).toHaveLength(12);
    expect(events[0].date).toBe("2026-05-01");
    expect(events[events.length - 1].date).toBe("2027-04-01");
    expect(sumAmounts(events)).toBe(1200);
  });

  it("two statements referencing the same event_id both fire on a single firing", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 4 },
        },
        {
          order: 2,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 3, denominator: 4 },
        },
      ],
    };
    expect(
      compile(template, 100_000, {
        eventFirings: [{ event_id: "ipo", date: "2026-04-01" }],
      }),
    ).toEqual([
      { date: "2026-04-01", amount: "25000" },
      { date: "2026-04-01", amount: "75000" },
    ]);
  });

  it("EVENT statement with no matching firing is silently skipped", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    expect(compile(template, 100_000, { eventFirings: [] })).toEqual([]);
  });

  it("all EVENT statements unfired emits zero events with no error", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
        },
        {
          order: 2,
          vesting_base: { type: "EVENT", event_id: "acquisition" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
        },
      ],
    };
    expect(compile(template, 100_000, {})).toEqual([]);
  });
});

describe("compile — hybrid DATE + EVENT templates", () => {
  it("DATE statement chains through; EVENT statement adds a chronological event", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: DATE_BASE,
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
          cliff: { length: 12, period_type: "MONTHS", percentage: { numerator: 1, denominator: 4 } },
          percentage: { numerator: 9, denominator: 10 },
        },
        {
          order: 2,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 10 },
        },
      ],
    };
    const events = compile(template, 100_000, {
      startDate: "2025-01-01",
      eventFirings: [{ event_id: "ipo", date: "2027-06-15" }],
    });
    expect(sumAmounts(events)).toBe(100_000);
    expect(events[0]).toEqual({ date: "2026-01-01", amount: "22500" });
    const ipoEvent = events.find((e) => e.date === "2027-06-15");
    expect(ipoEvent).toBeDefined();
    expect(ipoEvent!.amount).toBe("10000");
    for (let i = 1; i < events.length; i++) {
      expect(events[i].date >= events[i - 1].date).toBe(true);
    }
  });

  it("EVENT firing before grant_date is aggregated onto grant_date", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "early" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
        },
        {
          order: 2,
          vesting_base: { type: "EVENT", event_id: "late" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
        },
      ],
    };
    expect(
      compile(template, 100_000, {
        eventFirings: [
          { event_id: "early", date: "2025-03-01" },
          { event_id: "late", date: "2025-09-01" },
        ],
        grantDate: "2025-06-01",
      }),
    ).toEqual([
      { date: "2025-06-01", amount: "50000" },
      { date: "2025-09-01", amount: "50000" },
    ]);
  });

  it("EVENT firing on grant_date emits normally without held-back aggregation", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          vesting_base: { type: "EVENT", event_id: "ipo" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    };
    expect(
      compile(template, 100_000, {
        eventFirings: [{ event_id: "ipo", date: "2026-04-01" }],
        grantDate: "2026-04-01",
      }),
    ).toEqual([{ date: "2026-04-01", amount: "100000" }]);
  });
});

// Core-specific additions beyond the ported reference suite.
describe("compile — dual emit + runtime conventions (core additions)", () => {
  const monthly12: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        vesting_base: DATE_BASE,
        occurrences: 12,
        period: 1,
        period_type: "MONTHS",
        percentage: { numerator: 1, denominator: 1 },
      },
    ],
  };

  it("compileToInstallments returns numeric amounts; compile returns strings", () => {
    const nums = compileToInstallments(monthly12, 1200, startJan2025);
    const strs = compile(monthly12, 1200, startJan2025);
    expect(typeof nums[0].amount).toBe("number");
    expect(typeof strs[0].amount).toBe("string");
    expect(nums.map((i) => String(i.amount))).toEqual(strs.map((e) => e.amount));
    expect(nums.reduce((a, i) => a + i.amount, 0)).toBe(1200);
  });

  it("vestingDayOfMonth runtime convention shifts the day-of-month", () => {
    // Default policy preserves the start day (the 15th).
    const def = compile(monthly12, 1200, { startDate: "2025-01-15" });
    expect(def[0].date).toBe("2025-02-15");
    // A fixed-day policy pins every installment to the 1st.
    const firstOfMonth = compile(monthly12, 1200, {
      startDate: "2025-01-15",
      vestingDayOfMonth: "01",
    });
    expect(firstOfMonth[0].date).toBe("2025-02-01");
  });

  it("CUMULATIVE_ROUNDING runtime convention still telescopes to totalShares", () => {
    const events = compile(monthly12, 100, {
      startDate: "2025-01-01",
      allocationType: "CUMULATIVE_ROUNDING",
    });
    expect(sumAmounts(events)).toBe(100);
  });
});
