import { describe, it, expect } from "vitest";
import {
  validateVestingScheduleTemplate,
  validateVestingRuntime,
  assertValidVestingScheduleTemplate,
  assertValidVestingRuntime,
  MAX_INSTALLMENTS,
} from "../src/validate";
import type { VestingScheduleTemplate, VestingRuntime } from "@vestlang/types";

// A well-formed graded template: two chained DATE statements + one EVENT
// statement, with an on-grid cliff on the first.
const validTemplate: VestingScheduleTemplate = {
  id: "tmpl-1",
  statements: [
    {
      order: 1,
      vesting_base: { type: "DATE" },
      occurrences: 48,
      period: 1,
      period_type: "MONTHS",
      cliff: {
        length: 12,
        period_type: "MONTHS",
        percentage: { numerator: 12, denominator: 48 },
      },
      percentage: { numerator: 3, denominator: 4 },
    },
    {
      order: 2,
      vesting_base: { type: "EVENT", event_id: "ipo" },
      occurrences: 1,
      period: 0,
      period_type: "MONTHS",
      percentage: { numerator: 1, denominator: 4 },
    },
  ],
};

const pathsOf = (errors: { path: string }[]) => errors.map((e) => e.path);

const oneStatement = (occurrences: number): VestingScheduleTemplate => ({
  id: "tmpl-cap",
  statements: [
    {
      order: 1,
      vesting_base: { type: "DATE" },
      occurrences,
      period: 1,
      period_type: "MONTHS",
      percentage: { numerator: 1, denominator: 1 },
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

  it("rejects a bad fraction (non-integer numerator, denominator < 1)", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
          percentage: { numerator: 1.5, denominator: 0 },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toEqual(
      expect.arrayContaining([
        "statements[0].percentage.numerator",
        "statements[0].percentage.denominator",
      ]),
    );
  });

  it("rejects duplicate order", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 1,
          period: 1,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
        },
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 1,
          period: 1,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 2 },
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
          vesting_base: { type: "DATE" },
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
          cliff: {
            length: -1,
            // @ts-expect-error — exercising the runtime guard with an invalid unit
            period_type: "WEEKS",
            percentage: { numerator: 1, denominator: 4 },
          },
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toEqual(
      expect.arrayContaining([
        "statements[0].cliff.length",
        "statements[0].cliff.period_type",
      ]),
    );
  });

  it("rejects a cliff percentage outside [0, 1]", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 4,
          period: 1,
          period_type: "MONTHS",
          cliff: {
            length: 2,
            period_type: "MONTHS",
            percentage: { numerator: 3, denominator: 2 },
          },
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("statements[0].cliff.percentage");
  });

  it("rejects an unknown period_type", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          vesting_base: { type: "DATE" },
          occurrences: 1,
          period: 1,
          // @ts-expect-error — exercising the runtime guard with an invalid value
          period_type: "WEEKS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("statements[0].period_type");
  });

  it("rejects an EVENT base with a missing event_id", () => {
    const result = validateVestingScheduleTemplate({
      id: "x",
      statements: [
        {
          order: 1,
          // @ts-expect-error — EVENT base missing its required event_id
          vesting_base: { type: "EVENT" },
          occurrences: 1,
          period: 0,
          period_type: "MONTHS",
          percentage: { numerator: 1, denominator: 1 },
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain(
      "statements[0].vesting_base.event_id",
    );
  });

  it("assertValidVestingScheduleTemplate throws on invalid input", () => {
    expect(() =>
      assertValidVestingScheduleTemplate({ id: "", statements: [] }),
    ).toThrow(/Invalid VestingScheduleTemplate/);
  });
});

describe("validateVestingRuntime", () => {
  it("accepts a valid runtime for a DATE+EVENT template", () => {
    const runtime: VestingRuntime = {
      startDate: "2024-01-01",
      grantDate: "2024-01-01",
      eventFirings: [{ event_id: "ipo", date: "2026-01-01" }],
    };
    const result = validateVestingRuntime(runtime, validTemplate);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("requires startDate when a DATE statement exists", () => {
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

  it("rejects an event firing that matches no EVENT statement", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [{ event_id: "acquisition", date: "2026-01-01" }],
      },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("eventFirings[0].event_id");
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
  });

  it("rejects a realized_fraction outside [0, 1]", () => {
    const result = validateVestingRuntime(
      {
        startDate: "2024-01-01",
        eventFirings: [
          {
            event_id: "ipo",
            date: "2026-01-01",
            realized_fraction: { numerator: 3, denominator: 2 },
          },
        ],
      },
      validTemplate,
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain(
      "eventFirings[0].realized_fraction",
    );
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
  const withStatementPercentage = (p: {
    numerator: number;
    denominator: number;
  }): VestingScheduleTemplate => ({
    id: "tmpl-pct",
    statements: [
      {
        order: 1,
        vesting_base: { type: "DATE" },
        occurrences: 4,
        period: 1,
        period_type: "MONTHS",
        percentage: p,
      },
    ],
  });

  it("rejects a negative statement percentage", () => {
    const result = validateVestingScheduleTemplate(
      withStatementPercentage({ numerator: -1, denominator: 2 }),
    );
    expect(result.valid).toBe(false);
    expect(pathsOf(result.errors)).toContain("statements[0].percentage");
  });

  it("accepts a statement percentage of exactly 1", () => {
    const result = validateVestingScheduleTemplate(
      withStatementPercentage({ numerator: 1, denominator: 1 }),
    );
    expect(result.valid).toBe(true);
  });

  // Over-allocation is the evaluator's finding to raise, not the validator's to
  // reject — a single clause above 1 stays structurally valid here.
  it("accepts a statement percentage above 1 (over-allocation is a finding)", () => {
    const result = validateVestingScheduleTemplate(
      withStatementPercentage({ numerator: 3, denominator: 2 }),
    );
    expect(result.valid).toBe(true);
  });
});
