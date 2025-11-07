import { describe, it, expect } from "vitest";
import {
  makeImpossibleSchedule,
  makeStartPlusSchedule,
  makeResolvedSchedule,
  makeUnresolvedVestingStartSchedule,
  makeUnresolvedCliffInstallment,
} from "../src/evaluate/makeTranches.js";
import { ImpossibleBlocker, OCTDate } from "@vestlang/types";
import {
  makeVestingBaseDate,
  makeImpossibleConditionBlocker,
} from "./helpers.js";

describe("makeTranches", () => {
  it("makeResolvedTranches aligns dates and amounts", () => {
    const out = makeResolvedSchedule(
      ["2024-01-01", "2024-02-01"] as OCTDate[],
      [3, 7],
    );
    expect(out.installments).toEqual([
      { amount: 3, date: "2024-01-01" as OCTDate, meta: { state: "RESOLVED" } },
      { amount: 7, date: "2024-02-01" as OCTDate, meta: { state: "RESOLVED" } },
    ]);
  });

  it("makeStartPlusTranches steps are index * stepLength", () => {
    const out = makeStartPlusSchedule([1, 1, 1], "MONTHS", 3, [
      { type: "DATE_NOT_YET_OCCURRED", date: "2024-02-01" as OCTDate },
    ]);
    expect(out.installments.map((t) => t.meta.symbolicDate)).toEqual([
      { type: "START_PLUS", unit: "MONTHS", steps: 0 },
      { type: "START_PLUS", unit: "MONTHS", steps: 3 },
      { type: "START_PLUS", unit: "MONTHS", steps: 6 },
    ]);
    expect(out.installments[0].meta.unresolved).toContain("DATE 2024-02-01"); // stringified via blockerToString
  });

  it("makeImpossibleTranches repeats blockers and amounts", () => {
    const blockers: ImpossibleBlocker[] = [
      makeImpossibleConditionBlocker(
        makeVestingBaseDate("2025-01-01" as OCTDate),
      ),
    ];
    const out = makeImpossibleSchedule([5, 6], blockers);
    expect(out.installments).toHaveLength(2);
    expect(out.installments[0].meta.state).toBe("IMPOSSIBLE");
    expect(out.installments[1].meta.unresolved).toBe("DATE 2025-01-01");
  });

  it("before vesting start + before cliff use proper date meta", () => {
    const unresolvedStart = makeUnresolvedVestingStartSchedule([5], []);
    const symbolicDate = unresolvedStart.installments[0].meta.symbolicDate;
    expect(symbolicDate).toMatchObject({ type: "UNRESOLVED_VESTING_START" });

    const unresolvedCliff = makeUnresolvedCliffInstallment(
      "2024-03-01" as OCTDate,
      5,
      [],
    );
    const symbolicDate2 = unresolvedCliff.meta.symbolicDate;
    expect(symbolicDate2).toMatchObject({
      type: "UNRESOLVED_CLIFF",
      date: "2024-03-01" as OCTDate,
    });
  });
});
