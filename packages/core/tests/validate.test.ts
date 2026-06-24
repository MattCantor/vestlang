import { describe, it, expect } from "vitest";
import {
  validateVestingScheduleTemplate,
  validateVestingRuntime,
  assertValidVestingScheduleTemplate,
  assertValidVestingRuntime,
} from "../src/validate";
import {
  CONTINGENT_START_SENTINEL,
  MAX_INSTALLMENTS,
} from "@vestlang/primitives";
import type { VestingScheduleTemplate, VestingRuntime } from "@vestlang/types";

// A well-formed graded template: two chained DATE statements, with an on-grid
// cliff on the first.
const validTemplate: VestingScheduleTemplate = {
  id: "tmpl-1",
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
      percentage: "0.75",
    },
    {
      order: 2,
      schedule: {
        occurrences: 1,
        period: 0,
        period_type: "MONTHS",
      },
      percentage: "0.25",
    },
  ],
};

const pathsOf = (errors: { path: string }[]) => errors.map((e) => e.path);

const oneStatement = (occurrences: number): VestingScheduleTemplate => ({
  id: "tmpl-cap",
  statements: [
    {
      order: 1,
      schedule: {
        occurrences,
        period: 1,
        period_type: "MONTHS",
      },
      percentage: "1",
    },
  ],
});

describe("validateVestingScheduleTemplate", () => {
  it("accepts a well-formed template", () => {
    const result = validateVestingScheduleTemplate(validTemplate);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects an empty id", () => {
    const result = validateVestingScheduleTemplate({
      ...validTemplate,
      id: "",
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("id");
  });

  it("accepts a schedule at the installment cap", () => {
    const result = validateVestingScheduleTemplate(
      oneStatement(MAX_INSTALLMENTS),
    );
    expect(result.valid).toBe(true);
  });

  it("rejects a schedule that expands past the installment cap", () => {
    const result = validateVestingScheduleTemplate(
      oneStatement(MAX_INSTALLMENTS + 1),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /exceeds the limit/.test(e.message))).toBe(
      true,
    );
  });

  it("bounds the total across statements, not just one", () => {
    const half = Math.ceil(MAX_INSTALLMENTS / 2) + 1;
    const result = validateVestingScheduleTemplate({
      id: "tmpl-sum",
      statements: [
        { ...oneStatement(half).statements[0], order: 1 },
        { ...oneStatement(half).statements[0], order: 2 },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /exceeds the limit/.test(e.message))).toBe(
      true,
    );
  });

  it("rejects an empty statements array", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("statements");
  });

  it("rejects a malformed percentage string (not an OCF Numeric)", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
          },
          // Scientific notation isn't OCF Numeric — the boundary rejects it.
          percentage: "1.5e-3",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("statements[0].percentage");
  });

  it("rejects duplicate order", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
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
          order: 1,
          schedule: {
            occurrences: 1,
            period: 1,
            period_type: "MONTHS",
          },
          percentage: "0.5",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("duplicate order")),
    ).toBe(true);
  });

  it("rejects a cliff with a negative length or a bad period_type", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: -1,
              // @ts-expect-error — exercising the runtime guard with an invalid unit
              period_type: "WEEKS",
              percentage: "0.25",
            },
          },
          percentage: "1",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toEqual(
      expect.arrayContaining([
        "statements[0].schedule.cliff.length",
        "statements[0].schedule.cliff.period_type",
      ]),
    );
  });

  it("rejects a cliff percentage outside [0, 1]", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 4,
            period: 1,
            period_type: "MONTHS",
            cliff: {
              length: 2,
              period_type: "MONTHS",
              percentage: "1.5",
            },
          },
          percentage: "1",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain(
      "statements[0].schedule.cliff.percentage",
    );
  });

  it("rejects an unknown period_type", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          schedule: {
            occurrences: 1,
            period: 1,
            // @ts-expect-error — exercising the runtime guard with an invalid value
            period_type: "WEEKS",
          },
          percentage: "1",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain(
      "statements[0].schedule.period_type",
    );
  });

  it("assertValidVestingScheduleTemplate throws on invalid input", () => {
    expect(() =>
      assertValidVestingScheduleTemplate({ id: "", statements: [] }),
    ).toThrow(/Invalid VestingScheduleTemplate/);
  });
});

describe("validateVestingRuntime", () => {
  it("accepts a valid runtime for a DATE template", () => {
    const runtime: VestingRuntime = {
      startDate: "2024-01-01",
      grantDate: "2024-01-01",
    };
    const result = validateVestingRuntime(runtime, validTemplate);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts the contingent-start sentinel as the startDate", () => {
    // A persisted contingent placeholder carries the sentinel here; it is a real
    // calendar date, so it passes the format check and the compiler's sentinel-skip
    // handles it (it never reaches the date grid).
    const result = validateVestingRuntime(
      { startDate: CONTINGENT_START_SENTINEL, grantDate: "2024-01-01" },
      validTemplate,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires startDate when a statement exists", () => {
    const result = validateVestingRuntime({}, validTemplate);
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("startDate");
  });

  it("rejects a non-ISO startDate", () => {
    const result = validateVestingRuntime(
      { startDate: "01/01/2024" },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("startDate");
  });

  it("rejects a non-ISO firing date", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [{ event_id: "ipo", date: "Jan 1 2026" }],
      },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("eventFirings[0].date");
  });

  it("rejects duplicate event_id in firings", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [
          { event_id: "ipo", date: "2026-01-01" },
          { event_id: "ipo", date: "2026-02-01" },
        ],
      },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes("duplicate event_id")),
    ).toBe(true);
    expect(pathsOf(result.errors)).toContain("eventFirings");
  });

  it("assertValidVestingRuntime throws on invalid input", () => {
    expect(() => assertValidVestingRuntime({}, validTemplate)).toThrow(
      /Invalid VestingRuntime/,
    );
  });

  it("rejects an impossible calendar startDate instead of rolling it over", () => {
    const result = validateVestingRuntime(
      { startDate: "2025-02-31" },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("startDate");
  });

  it("rejects an impossible calendar grantDate", () => {
    const result = validateVestingRuntime(
      { startDate: "2024-01-01", grantDate: "2025-13-01" },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("grantDate");
  });

  it("rejects an impossible calendar firing date", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [{ event_id: "ipo", date: "2026-02-30" }],
      },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("eventFirings[0].date");
  });
});

describe("validateStatement — percentage bounds", () => {
  const withStatementPercentage = (p: string): VestingScheduleTemplate => ({
    id: "tmpl-pct",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: p,
      },
    ],
  });

  it("rejects a negative statement percentage", () => {
    // A well-formed Numeric, but the parsed value is negative — rejected.
    const result = validateVestingScheduleTemplate(
      withStatementPercentage("-0.5"),
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("statements[0].percentage");
  });

  it("accepts a statement percentage of exactly 1", () => {
    const result = validateVestingScheduleTemplate(
      withStatementPercentage("1"),
    );
    expect(result.valid).toBe(true);
  });

  // Over-allocation is the evaluator's finding to raise, not the validator's to
  // reject — a single clause above 1 stays structurally valid here.
  it("accepts a statement percentage above 1 (over-allocation is a finding)", () => {
    const result = validateVestingScheduleTemplate(
      withStatementPercentage("1.5"),
    );
    expect(result.valid).toBe(true);
  });
});

// #255 — event_condition shape validation. A non-empty event_id is required; an
// unfired event_condition (no matching firing) is the VALID held state, never
// rejected. No firing↔condition cross-check in either direction (AC 16).
describe("validateVestingScheduleTemplate — event_condition (#255)", () => {
  const withCondition = (
    event_condition: unknown,
  ): VestingScheduleTemplate => ({
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
        // Untrusted input may carry a shape the static type forbids.
        event_condition: event_condition as { event_id: string },
      },
    ],
  });

  it("accepts a well-formed event_condition (bare real id)", () => {
    expect(
      validateVestingScheduleTemplate(withCondition({ event_id: "ipo" })).valid,
    ).toBe(true);
  });

  it("accepts a synthetic event_condition id", () => {
    expect(
      validateVestingScheduleTemplate(withCondition({ event_id: "evt:1" }))
        .valid,
    ).toBe(true);
  });

  it("rejects an empty event_id", () => {
    const result = validateVestingScheduleTemplate(
      withCondition({ event_id: "" }),
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain(
      "statements[0].event_condition.event_id",
    );
  });

  it("rejects a non-string event_id", () => {
    const result = validateVestingScheduleTemplate(withCondition({}));
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain(
      "statements[0].event_condition.event_id",
    );
  });
});

// AC 16: a runtime carrying an event_condition with NO matching firing validates
// as VALID (the held state). Neither an unreferenced firing nor an orphan condition
// is rejected — the validator never cross-checks the two.
describe("validateVestingRuntime — held event_condition is valid (#255 AC16)", () => {
  const conditionTemplate: VestingScheduleTemplate = {
    id: "t1",
    statements: [
      {
        order: 1,
        schedule: {
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
        },
        percentage: "1",
        event_condition: { event_id: "ipo" },
      },
    ],
  };

  it("a runtime with NO firing for the condition validates (held)", () => {
    const runtime: VestingRuntime = { startDate: "2025-01-01" };
    expect(validateVestingRuntime(runtime, conditionTemplate).valid).toBe(true);
  });

  it("an eventFirings entry that no condition references is not rejected", () => {
    const runtime: VestingRuntime = {
      startDate: "2025-01-01",
      eventFirings: [{ event_id: "unrelated", date: "2026-01-01" }],
    };
    expect(validateVestingRuntime(runtime, conditionTemplate).valid).toBe(true);
  });
});

// Issue #390 AC7 — the optional-schedule invariant. A statement must carry a
// schedule, an event_condition, or both; the neither-corner is rejected. A
// schedule-less statement with an event_condition (a pure milestone) validates, and
// counts as one installment toward the cap.
describe("validateVestingScheduleTemplate — optional-schedule invariant (#390)", () => {
  it("accepts a schedule-less statement that has an event_condition (pure milestone)", () => {
    const result = validateVestingScheduleTemplate({
      id: "milestone",
      statements: [
        { order: 1, percentage: "1", event_condition: { event_id: "ipo" } },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a statement with neither a schedule nor an event_condition", () => {
    const result = validateVestingScheduleTemplate({
      id: "neither",
      statements: [
        // The static type forbids this corner; the validator guards it on untrusted
        // wire input where the type guarantee doesn't hold.
        { order: 1, percentage: "1" } as never,
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("statements[0]");
    expect(
      result.errors.some((e) =>
        /must carry a schedule, an event_condition, or both/.test(e.message),
      ),
    ).toBe(true);
  });

  it("counts a schedule-less statement as one installment toward the cap", () => {
    // MAX_INSTALLMENTS scheduled occurrences PLUS one schedule-less milestone is
    // MAX + 1 — over the cap by exactly the milestone's single installment.
    const result = validateVestingScheduleTemplate({
      id: "cap-with-milestone",
      statements: [
        { ...oneStatement(MAX_INSTALLMENTS).statements[0], order: 1 },
        { order: 2, percentage: "0", event_condition: { event_id: "ipo" } },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => /exceeds the limit/.test(e.message))).toBe(
      true,
    );
  });

  it("a milestone just under the cap (MAX − 1 scheduled + 1 milestone = MAX) is accepted", () => {
    const result = validateVestingScheduleTemplate({
      id: "cap-edge",
      statements: [
        { ...oneStatement(MAX_INSTALLMENTS - 1).statements[0], order: 1 },
        { order: 2, percentage: "0", event_condition: { event_id: "ipo" } },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

describe("validateVestingRuntime — edge branches", () => {
  const emptyTemplate: VestingScheduleTemplate = {
    id: "empty",
    statements: [],
  };

  it("an empty template needs no startDate", () => {
    // hasStatements is false, so the startDate-required check is skipped entirely.
    const result = validateVestingRuntime({}, emptyTemplate);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("an empty template still format-checks a startDate that is present", () => {
    const result = validateVestingRuntime(
      { startDate: "01/01/2024" },
      emptyTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("startDate");
  });

  it("rejects a non-array eventFirings", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: "nope",
      } as unknown as VestingRuntime,
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("eventFirings");
  });

  it("rejects a firing with an empty event_id", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [{ event_id: "", date: "2026-01-01" }],
      },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("eventFirings[0].event_id");
  });

  it("rejects a firing whose event_id is not a string", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [{ event_id: 123, date: "2026-01-01" }],
      } as unknown as VestingRuntime,
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("eventFirings[0].event_id");
  });

  it("tolerates a null firing entry without throwing (optional chaining)", () => {
    // A malformed null entry must surface as field errors, not a crash — the
    // optional chaining on event_id / date is what keeps it graceful.
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [null],
      } as unknown as VestingRuntime,
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("eventFirings[0].event_id");
    expect(pathsOf(result.errors)).toContain("eventFirings[0].date");
  });
});
