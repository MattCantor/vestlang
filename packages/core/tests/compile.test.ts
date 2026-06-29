import { describe, it, expect } from "vitest";
import { compile, compileToInstallments } from "../src/compile";
import { addPeriod } from "@vestlang/primitives";
import { CONTINGENT_START_SENTINEL, fractionToNumeric } from "@vestlang/utils";
import type {
  VestingRuntime,
  VestingScheduleTemplate,
  VestingSchedule,
} from "@vestlang/types";

// Conformance suite for the canonical-IR compile (`compile` / `compileToInstallments`).

const sumAmounts = (events: { amount: string }[]): number =>
  events.reduce((acc, e) => acc + Number(e.amount), 0);

const startJan2025: VestingRuntime = { startDate: "2025-01-01" };

describe("compile — standard 4yr/1mo with 25% cliff", () => {
  const template: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
          cliff: {
            length: 12,
            period_type: "MONTHS",
            percentage: "0.25",
          },
        },
        percentage: "1",
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
        schedule: {
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
          cliff: {
            length: 12,
            period_type: "MONTHS",
            percentage: "0.3",
          },
        },
        percentage: "1",
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
  const mkYear = (
    order: number,
    num: number,
  ): VestingScheduleTemplate["statements"][number] => ({
    order,
    schedule: {
      occurrences: 1,
      period: 12,
      period_type: "MONTHS",
    },
    percentage: fractionToNumeric({ numerator: num, denominator: 20 }),
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
          schedule: {
            occurrences: 48,
            period: 1,
            period_type: "MONTHS",
          },
          percentage: "1",
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
          schedule: {
            occurrences: 12,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 12,
              period_type: "MONTHS",
              percentage: "1",
            },
          },
          percentage: "1",
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
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 75,
              period_type: "DAYS",
              percentage: "0.5",
            },
          },
          percentage: "1",
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
          schedule: {
            occurrences: 4,
            period: 7,
            period_type: "DAYS",
          },
          percentage: "1",
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
          schedule: {
            occurrences: 6,
            period: 1,
            period_type: "MONTHS",
          },
          percentage: "1",
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
          schedule: {
            occurrences: 1,
            period: 12,
            period_type: "MONTHS",
          },
          percentage: "0.5",
        },
        {
          order: 2,
          schedule: {
            occurrences: 1,
            period: 12,
            period_type: "MONTHS",
          },
          percentage: "0.5",
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
          schedule: {
            occurrences: 1,
            period: 12,
            period_type: "MONTHS",
          },
          percentage: "0",
        },
        {
          order: 2,
          schedule: {
            occurrences: 1,
            period: 12,
            period_type: "MONTHS",
          },
          percentage: "1",
        },
      ],
    };
    expect(compile(template, 100, startJan2025)).toEqual([
      { date: "2027-01-01", amount: "100" },
    ]);
  });

  it("throws when totalShares is not a non-negative safe integer", () => {
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 1,
            period: 12,
            period_type: "MONTHS",
          },
          percentage: "1",
        },
      ],
    };
    expect(() => compile(template, -1, startJan2025)).toThrow(
      /non-negative safe integer/,
    );
    expect(() => compile(template, 1.5, startJan2025)).toThrow(
      /non-negative safe integer/,
    );
    // Number.isInteger(2 ** 53 + 2) is true — the exact hole the safe check closes.
    expect(() => compile(template, 2 ** 53 + 2, startJan2025)).toThrow(
      /non-negative safe integer/,
    );
  });
});

// A duration cliff honors its stated percentage wherever it can land — on the
// vesting start, before the first installment, or at an interior point — and
// throws only when the percentage can't be placed: below 100% with nothing after
// the cliff, or dated before the vesting start. These are reachable through direct
// template input (the DSL never mints them).
describe("compile — fixed cliff honors its percentage at the left edge", () => {
  const monthly = (
    occurrences: number,
    cliff: VestingSchedule["cliff"],
  ): VestingScheduleTemplate => ({
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences,
          period: 1,
          period_type: "MONTHS",
          ...(cliff ? { cliff } : {}),
        },
        percentage: "1",
      },
    ],
  });

  it("a length-0 cliff vests its percentage upfront on the start date", () => {
    // 25% on 2025-01-01 (the start), then 75% spread over the 12 monthly grid
    // points. Previously the cliff silently dropped and the grid vested evenly.
    const events = compile(
      monthly(12, {
        length: 0,
        period_type: "MONTHS",
        percentage: "0.25",
      }),
      120_000,
      startJan2025,
    );
    expect(events[0]).toEqual({ date: "2025-01-01", amount: "30000" });
    expect(events).toHaveLength(13);
    expect(sumAmounts(events)).toBe(120_000);
  });

  it("a cliff dated before the first installment still vests its percentage", () => {
    // Cliff 10 days in (2025-01-11), ahead of the first Feb 1 occurrence: 25% on
    // 2025-01-11, then 75% over the 12 months. (#254 — previously an even grid.)
    const events = compile(
      monthly(12, {
        length: 10,
        period_type: "DAYS",
        percentage: "0.25",
      }),
      120_000,
      startJan2025,
    );
    expect(events[0]).toEqual({ date: "2025-01-11", amount: "30000" });
    expect(events).toHaveLength(13);
    expect(sumAmounts(events)).toBe(120_000);
  });

  it("an interior cliff with a free-form percentage lumps then spreads the rest", () => {
    // 3 months in from 2025-01-01 lands the cliff on 2025-04-01: a 50% lump, then
    // 50% over the 9 later months.
    const events = compile(
      monthly(12, {
        length: 3,
        period_type: "MONTHS",
        percentage: "0.5",
      }),
      1200,
      startJan2025,
    );
    expect(events[0]).toEqual({ date: "2025-04-01", amount: "600" });
    expect(sumAmounts(events)).toBe(1200);
  });

  it("a cliff below 100% that swallows the whole grid throws", () => {
    // 12-month cliff on a 12-month grid at 25%: nothing lands strictly after, so
    // the remaining 75% has nowhere to vest.
    expect(() =>
      compile(
        monthly(12, {
          length: 12,
          period_type: "MONTHS",
          percentage: "0.25",
        }),
        120_000,
        startJan2025,
      ),
    ).toThrow(/percentage < 1 leaves no occurrence after the cliff date/);
  });

  it("a zero-spacing grid with a sub-100% cliff throws (nothing after the cliff)", () => {
    // period 0 stacks every occurrence on the start; a length-0 cliff lands there
    // too, so no installment is strictly after it. 25% leaves 75% homeless.
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 4,
            period: 0,
            period_type: "MONTHS",
            cliff: {
              length: 0,
              period_type: "MONTHS",
              percentage: "0.25",
            },
          },
          percentage: "1",
        },
      ],
    };
    expect(() => compile(template, 400, startJan2025)).toThrow(
      /percentage < 1 leaves no occurrence after the cliff date/,
    );
  });

  it("a vesting-day policy pulling the cliff before the anchor throws", () => {
    // Anchor 2025-01-15, a length-0 MONTHS cliff under FIRST_DAY_OF_MONTH snaps to
    // 2025-01-01 — before the grant began. The two throws read distinctly.
    const template: VestingScheduleTemplate = {
      id: "t1",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 0,
              period_type: "MONTHS",
              percentage: "0.25",
            },
          },
          percentage: "1",
        },
      ],
    };
    expect(() =>
      compile(template, 400, {
        startDate: "2025-01-15",
        vestingDayOfMonth: "FIRST_DAY_OF_MONTH",
      }),
    ).toThrow(/falls before the statement's start/);
  });
});

// R2-B23: an over-1 statement percentage is deliberately valid template input
// (over-allocation is a finding's job, not the validator's). Output stays
// uncapped at sane sizes; where the quotient would no longer cast exactly, the
// kernel refuses loudly instead of rounding per-installment amounts.
describe("compile — over-allocated template hits the kernel's cast bound (R2-B23)", () => {
  const template: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 1,
          period: 12,
          period_type: "MONTHS",
        },
        percentage: "1.5",
      },
    ],
  };

  it("still compiles uncapped at a sane grant size", () => {
    expect(compile(template, 100, startJan2025)).toEqual([
      { date: "2026-01-01", amount: "150" },
    ]);
  });

  it("refuses loudly when the over-1 quotient exceeds MAX_SAFE_INTEGER", () => {
    expect(() =>
      compile(template, 9_007_199_254_740_990, startJan2025),
    ).toThrow(/exceeds Number.MAX_SAFE_INTEGER/);
  });
});

describe("compile — month-end chain matches its un-split grid (#34)", () => {
  // Splitting a schedule into chained segments shouldn't change the dates it
  // vests on. Start a monthly schedule on Jan 31: the first hop clamps to Feb 28
  // (February has no 31st), and a naive chain would then anchor on the 28th and
  // stay there. Carrying the Jan 31 origin through the chain springs the later
  // tranches back onto the month-end the way a single un-split schedule does.

  // Head: one tranche (Feb 28). Tail: two more (Mar, Apr), chaining off the head.
  const chain: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 1,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "0.3333333333",
      },
      {
        order: 2,
        schedule: {
          occurrences: 2,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "0.6666666666",
      },
    ],
  };

  // The same schedule written as one statement of three tranches.
  const unsplit: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 3,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
      },
    ],
  };

  const janEnd: VestingRuntime = { startDate: "2025-01-31" };

  // The split stores 1/3 and 2/3 as truncated Numeric decimals ("0.3333333333"
  // / "0.6666666666"), so the first tranche floors to 999 rather than 1000 — the
  // precision-loss share the Numeric storage introduces. The un-split schedule
  // stores "1" exactly and keeps the full 1000/1000/1000, so the two now agree on
  // dates but not on the first amount. (The precision guard warns about exactly
  // this; see the precision tests.)
  it("chains onto Feb 28, Mar 31, Apr 30 — not stuck on the 28th", () => {
    expect(compile(chain, 3000, janEnd)).toEqual([
      { date: "2025-02-28", amount: "999" },
      { date: "2025-03-31", amount: "1000" },
      { date: "2025-04-30", amount: "1000" },
    ]);
  });

  it("produces identical dates to the un-split schedule", () => {
    expect(compile(chain, 3000, janEnd).map((e) => e.date)).toEqual(
      compile(unsplit, 3000, janEnd).map((e) => e.date),
    );
  });

  it("leaves a day-of-month that always fits untouched (the 15th)", () => {
    // A mid-month start never clamps, so the chain and the un-split schedule grid
    // on the same dates; this pins that the origin threading didn't disturb them.
    const midMonth: VestingRuntime = { startDate: "2025-01-15" };
    const chained = compile(chain, 3000, midMonth);
    expect(chained.map((e) => e.date)).toEqual([
      "2025-02-15",
      "2025-03-15",
      "2025-04-15",
    ]);
    expect(chained.map((e) => e.date)).toEqual(
      compile(unsplit, 3000, midMonth).map((e) => e.date),
    );
  });
});

describe("compile — grant_date handling (DATE-anchored)", () => {
  const monthlyNoCliff: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
      },
    ],
  };

  const monthlyWithCliff: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
          cliff: {
            length: 12,
            period_type: "MONTHS",
            percentage: "0.25",
          },
        },
        percentage: "1",
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

// The canonical base is DATE-only now; a contingent start is a DATE statement on
// the CONTINGENT_START_SENTINEL placeholder, re-derived to a real date on reload. A
// real run off year 9999 overflows the date math, so the compiler must recognize
// the sentinel and emit NO dated tranches (AC 10). A resolved contingent start
// reaches the compiler with a real startDate substituted in (the projection-only
// runtime rehydrate builds), so the grid is ordinary then.
describe("compile — contingent-start sentinel skip (AC 10)", () => {
  const monthly48: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
          cliff: {
            length: 12,
            period_type: "MONTHS",
            percentage: "0.25",
          },
        },
        percentage: "1",
      },
    ],
  };

  it("an unresolved placeholder (startDate = sentinel) projects to nothing, no throw", () => {
    expect(() =>
      compile(monthly48, 100_000, {
        startDate: CONTINGENT_START_SENTINEL,
        grantDate: "2025-01-01",
      }),
    ).not.toThrow();
    expect(
      compile(monthly48, 100_000, {
        startDate: CONTINGENT_START_SENTINEL,
        grantDate: "2025-01-01",
      }),
    ).toEqual([]);
  });

  it("the sentinel never reaches the date grid (it would overflow addPeriod)", () => {
    // A real run off year 9999 overflows the date math, so a non-empty projection
    // here would mean the sentinel leaked onto the grid. The empty result is the
    // proof it was skipped before any stepping.
    expect(
      compileToInstallments(monthly48, 100_000, {
        startDate: CONTINGENT_START_SENTINEL,
        grantDate: "2025-01-01",
      }),
    ).toEqual([]);
    // Direct guard, pinned beside the skip: stepping the sentinel forward by even
    // one period throws, so the empty projection above is the skip working — not a
    // coincidence that survives if the date-range overflow guard is ever loosened.
    expect(() => addPeriod(CONTINGENT_START_SENTINEL, 1, "MONTHS")).toThrow(
      /range/,
    );
  });

  it("a real start substituted in compiles the ordinary grid", () => {
    // What rehydrate hands the compiler once the contingent start resolves: the
    // sentinel is gone, replaced by the re-derived date, so the grid is normal.
    const events = compile(monthly48, 100_000, {
      startDate: "2025-01-01",
      grantDate: "2025-01-01",
    });
    expect(events).toHaveLength(37); // 12-month cliff lump + 36 monthly
    expect(events[0]).toEqual({ date: "2026-01-01", amount: "25000" });
    expect(sumAmounts(events)).toBe(100_000);
  });
});

// Core-specific additions beyond the ported reference suite.
describe("compile — dual emit + runtime conventions (core additions)", () => {
  const monthly12: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 12,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
      },
    ],
  };

  it("compileToInstallments returns numeric amounts; compile returns strings", () => {
    const nums = compileToInstallments(monthly12, 1200, startJan2025);
    const strs = compile(monthly12, 1200, startJan2025);
    expect(typeof nums[0].amount).toBe("number");
    expect(typeof strs[0].amount).toBe("string");
    expect(nums.map((i) => String(i.amount))).toEqual(
      strs.map((e) => e.amount),
    );
    expect(nums.reduce((a, i) => a + i.amount, 0)).toBe(1200);
  });

  it("vestingDayOfMonth runtime convention shifts the day-of-month", () => {
    // Default policy preserves the start day (the 15th).
    const def = compile(monthly12, 1200, { startDate: "2025-01-15" });
    expect(def[0].date).toBe("2025-02-15");
    // FIRST_DAY_OF_MONTH pins every installment to the 1st.
    const firstOfMonth = compile(monthly12, 1200, {
      startDate: "2025-01-15",
      vestingDayOfMonth: "FIRST_DAY_OF_MONTH",
    });
    expect(firstOfMonth[0].date).toBe("2025-02-01");
  });
});

describe("compile — boundary hardening", () => {
  it("rejects a fixed cliff that would silently drop shares past the grid", () => {
    // 12×1-month, cliff {24mo, 1/4}, 1200 shares: every occurrence is at or
    // behind the cliff, so 900 shares used to vanish. The kernel now refuses at
    // expansion time, where the statement's true anchor and origin are known.
    const template: VestingScheduleTemplate = {
      id: "swallow",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 12,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 24,
              period_type: "MONTHS",
              percentage: "0.25",
            },
          },
          percentage: "1",
        },
      ],
    };
    expect(() => compile(template, 1200, startJan2025)).toThrow(
      /leaves no occurrence after the cliff date/,
    );
  });

  it("accepts a swallowing cliff at percentage exactly 1 and conserves the grant", () => {
    // With the whole statement in the lump there is no remainder to lose: one
    // installment on the cliff date, summing to the full grant.
    const template: VestingScheduleTemplate = {
      id: "swallow-whole",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 12,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 24,
              period_type: "MONTHS",
              percentage: "1",
            },
          },
          percentage: "1",
        },
      ],
    };
    const out = compile(template, 1200, startJan2025);
    expect(out).toEqual([{ date: "2027-01-01", amount: "1200" }]);
  });

  it("accepts a sub-1 cliff that leaves occurrences after it", () => {
    const template: VestingScheduleTemplate = {
      id: "normal-cliff",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 48,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 12,
              period_type: "MONTHS",
              percentage: "0.25",
            },
          },
          percentage: "1",
        },
      ],
    };
    const out = compile(template, 1200, startJan2025);
    expect(sumAmounts(out)).toBe(1200);
  });

  it("checks a chained statement's cliff and names the statement", () => {
    // Statement 2 chains off statement 1 (anchor 2026-01-01); its 12×1-month
    // grid ends at 2027-01-01, inside the 13-month cliff at 2027-02-01.
    const template: VestingScheduleTemplate = {
      id: "chained-swallow",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 12,
            period: 1,
            period_type: "MONTHS",
          },
          percentage: "0.5",
        },
        {
          order: 2,
          schedule: {
            occurrences: 12,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 13,
              period_type: "MONTHS",
              percentage: "0.25",
            },
          },
          percentage: "0.5",
        },
      ],
    };
    expect(() => compile(template, 1200, startJan2025)).toThrow(
      /statement 2: fixed cliff/,
    );
  });

  it("judges a mixed-unit cliff from the chained anchor, not startDate", () => {
    // Days-vs-months is where the verdict depends on the anchor. Statement 2
    // truly anchors at 2026-02-01: its 1-month cliff lands 2026-03-01, 28 days
    // out, so the 30-day occurrence (2026-03-03) clears it — legal. Measured
    // from startDate (2026-01-01) the same cliff spans 31 days and the
    // occurrence would look swallowed; the check must not reject from there.
    const template: VestingScheduleTemplate = {
      id: "chained-mixed-units",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 1,
            period: 1,
            period_type: "MONTHS",
          },
          percentage: "0.5",
        },
        {
          order: 2,
          schedule: {
            occurrences: 1,
            period: 30,
            period_type: "DAYS",
            cliff: {
              length: 1,
              period_type: "MONTHS",
              percentage: "0.5",
            },
          },
          percentage: "0.5",
        },
      ],
    };
    const out = compile(template, 1200, { startDate: "2026-01-01" });
    expect(sumAmounts(out)).toBe(1200);
  });

  it("rejects a negative statement percentage rather than emitting negatives", () => {
    const template: VestingScheduleTemplate = {
      id: "neg",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
          },
          percentage: "-0.5",
        },
      ],
    };
    expect(() => compile(template, 100, startJan2025)).toThrow(
      /Invalid VestingScheduleTemplate/,
    );
  });

  it("rejects an impossible calendar startDate rather than rolling it forward", () => {
    const template: VestingScheduleTemplate = {
      id: "rollover",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
          },
          percentage: "1",
        },
      ],
    };
    expect(() => compile(template, 100, { startDate: "2025-02-31" })).toThrow(
      /Invalid VestingRuntime/,
    );
  });
});

describe("compile — event-conditioned statement (event hold)", () => {
  // A scheduled statement that also waits on a named event: the whole grid stays
  // held until the event fires, then folds at max(time-cliff baseline, firing) as
  // one proportional cliff.
  const template: VestingScheduleTemplate = {
    id: "evt",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 48,
          period: 1,
          period_type: "MONTHS",
          cliff: { length: 12, period_type: "MONTHS", percentage: "0.25" },
        },
        event_condition: { event_id: "ipo" },
        percentage: "1",
      },
    ],
  };

  it("emits nothing while the event is unfired", () => {
    // No matching firing in the runtime, so the grid never releases.
    expect(compile(template, 100_000, startJan2025)).toEqual([]);
  });

  it("folds on the firing date when the firing is after the cliff baseline", () => {
    // baseline = start + 12mo = 2026-01-01; the 2026-07-01 firing is later, so the
    // proportional lump lands on the firing date.
    const events = compile(template, 100_000, {
      startDate: "2025-01-01",
      eventFirings: [{ event_id: "ipo", date: "2026-07-01" }],
    });
    expect(events[0].date).toBe("2026-07-01");
    expect(sumAmounts(events)).toBe(100_000);
  });

  it("folds on the cliff baseline when the firing precedes it", () => {
    // The 2025-04-01 firing is before the 2026-01-01 baseline, so the baseline
    // floors the fold point: the lump lands on 2026-01-01, not the earlier firing.
    const events = compile(template, 100_000, {
      startDate: "2025-01-01",
      eventFirings: [{ event_id: "ipo", date: "2025-04-01" }],
    });
    expect(events[0].date).toBe("2026-01-01");
    expect(sumAmounts(events)).toBe(100_000);
  });
});

describe("compile — pure milestone (no schedule)", () => {
  // A statement carrying an event_condition and no schedule: it projects nothing
  // until the event fires, then vests its whole share as one lump on that date.
  const template: VestingScheduleTemplate = {
    id: "ms",
    statements: [
      { order: 1, event_condition: { event_id: "ipo" }, percentage: "1" },
    ],
  };

  it("projects nothing while unfired", () => {
    expect(compile(template, 100_000, startJan2025)).toEqual([]);
  });

  it("vests the whole share as one lump on the firing date", () => {
    const events = compile(template, 100_000, {
      startDate: "2025-01-01",
      eventFirings: [{ event_id: "ipo", date: "2027-03-01" }],
    });
    expect(events).toEqual([{ date: "2027-03-01", amount: "100000" }]);
  });
});

describe("compile — statement ordering and the zero-share boundary", () => {
  it("sorts statements by order, not array position", () => {
    // Two chained years written out of order: a 25% first year, a 75% second year.
    // The compiler must process them by `order` (so the 75% lands in year two),
    // regardless of how the array is arranged.
    const monthly = {
      occurrences: 12,
      period: 1,
      period_type: "MONTHS" as const,
    };
    const template: VestingScheduleTemplate = {
      id: "ord",
      statements: [
        { order: 2, schedule: monthly, percentage: "0.75" },
        { order: 1, schedule: monthly, percentage: "0.25" },
      ],
    };
    const events = compile(template, 100_000, startJan2025);
    expect(events).toHaveLength(24);
    // Output is date-sorted: the first year is statement 1 (25%), the second
    // year statement 2 (75%). A broken sort would flip the two halves.
    expect(sumAmounts(events.slice(0, 12))).toBe(25_000);
    expect(sumAmounts(events.slice(12))).toBe(75_000);
  });

  it("allows a zero-share grant (the non-negative boundary includes 0)", () => {
    const template: VestingScheduleTemplate = {
      id: "zero",
      statements: [
        {
          order: 1,
          schedule: { occurrences: 4, period: 1, period_type: "MONTHS" },
          percentage: "1",
        },
      ],
    };
    expect(sumAmounts(compile(template, 0, startJan2025))).toBe(0);
  });
});

// #431 — `compile` / `compileToInstallments` are byte-identical and do NOT clamp.
// The retype of the structural verdict (and the docstring nudges toward
// `validateTemplateAllocatable`) must not move the compiled stream. These pins are
// hand-written literals, not snapshots: a snapshot's first run would write-and-pass
// and certify nothing, so the output is committed inline and a shift fails loudly.
describe("compile — byte-identical output and no over-allocation clamp (#431)", () => {
  // The same two-statement shape the #418 / validate.test.ts allocatability block
  // uses: each statement a single 12-month lump, distinct order. Reused here so the
  // 100% and 150% cases line up with the checker's fixtures.
  const statement = (order: number, percentage: string) => ({
    order,
    schedule: {
      occurrences: 1,
      period: 12,
      period_type: "MONTHS" as const,
    },
    percentage,
  });
  const template = (...percentages: string[]): VestingScheduleTemplate => ({
    id: "alloc",
    statements: percentages.map((p, i) => statement(i + 1, p)),
  });
  const runtime: VestingRuntime = { startDate: "2024-01-01" };
  const totalShares = 4800;

  it("100% template — pinned CompiledEvent[] (string amounts)", () => {
    expect(compile(template("0.75", "0.25"), totalShares, runtime)).toEqual([
      { date: "2025-01-01", amount: "3600" },
      { date: "2026-01-01", amount: "1200" },
    ]);
  });

  it("100% template — pinned CompiledInstallment[] (number amounts)", () => {
    expect(
      compileToInstallments(template("0.75", "0.25"), totalShares, runtime),
    ).toEqual([
      { date: "2025-01-01", amount: 3600 },
      { date: "2026-01-01", amount: 1200 },
    ]);
  });

  // No allocatability gate in the compiler: the 150% template compiles to two full
  // 3600-share lumps (7200 > 4800), exactly as before. If a clamp ever crept into
  // allocate.ts the second amount would shrink and these literals would fail.
  it("150% template still compiles to an over-vesting stream — pinned, no clamp", () => {
    const t150 = template("0.75", "0.75");
    expect(compile(t150, totalShares, runtime)).toEqual([
      { date: "2025-01-01", amount: "3600" },
      { date: "2026-01-01", amount: "3600" },
    ]);
    expect(compileToInstallments(t150, totalShares, runtime)).toEqual([
      { date: "2025-01-01", amount: 3600 },
      { date: "2026-01-01", amount: 3600 },
    ]);
    // 7200 > 4800 totalShares — the over-vesting sum is the proof there's no clamp.
    expect(sumAmounts(compile(t150, totalShares, runtime))).toBe(7200);
  });
});
