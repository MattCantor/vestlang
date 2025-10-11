// packages/normalizer/test/normalizer.test.ts
import { describe, it, expect } from "vitest";
import { NormalizerError } from "../src/errors";
import { createEvent, createSchedule, createStatement } from "./helpers";
import { Schedule } from "../src/normalizer/schedule";
import { normalizeStatement } from "../src/normalizer";

describe("normalizeStatement / normalizeExpr", () => {
  it("normalizes a simple schedule with default FROM=Event('grantDate')", () => {
    const ast = createSchedule(12, 1, "MONTHS", undefined, undefined);
    const st = normalizeStatement(createStatement(ast));
    expect(st.expr.type).toBe("SINGLETON");
    const sch = st.expr as Schedule;

    // vesting_start should be an unqualified Event('grantDate')
    if ("items" in sch.vesting_start) {
      throw new Error("vesting_start should not be a combinator here");
    } else {
      expect(sch.vesting_start.type).toBe("BARE");
      expect(sch.vesting_start.base).toEqual(createEvent("grantDate"));
    }

    // periodicity
    expect(sch.periodicity.periodType).toBe("MONTHS");
    expect((sch.periodicity as any).span).toBe(12);
    expect((sch.periodicity as any).step).toBe(1);
    expect((sch.periodicity as any).count).toBe(12);
    // placeholder for vesting_day_of_month
    expect((sch.periodicity as any).vesting_day_of_month).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });
});

describe("Periodicity", () => {
  it("validates OVER and EVERY and computes span/step/count", () => {
    const ast = createSchedule(18, 6, "MONTHS", createEvent("grantDate"));
    const sch = normalizeStatement(createStatement(ast)).expr as Schedule;
    expect(sch.periodicity.periodType).toBe("MONTHS");
    expect((sch.periodicity as any).span).toBe(18);
    expect((sch.periodicity as any).step).toBe(6);
    expect((sch.periodicity as any).count).toBe(3);
  });

  it("throws when OVER % EVERY !== 0", () => {
    const ast = createSchedule(10, 3, "DAYS", createEvent("grantDate"));
    expect(() => normalizeStatement(createStatement(ast))).toThrowError(
      NormalizerError,
    );
  });

  it("keeps vesting_day_of_month placeholder for MONTHS", () => {
    const ast = createSchedule(12, 1, "MONTHS", createEvent("grantDate"));
    const sch = normalizeStatement(createStatement(ast)).expr as Schedule;
    expect((sch.periodicity as any).vesting_day_of_month).toBe(
      "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    );
  });
});
