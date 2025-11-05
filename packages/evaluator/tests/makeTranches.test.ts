import { describe, it, expect } from "vitest";
import {
  makeImpossibleTranches,
  makeStartPlusTranches,
  makeResolvedTranches,
  makeBeforeVestingStartTranche,
  makeBeforeCliffTranche,
} from "../src/evaluate/makeTranches.js";
import { ImpossibleBlocker, OCTDate } from "@vestlang/types";
import {
  makeVestingBaseDate,
  makeImpossibleConditionBlocker,
} from "./helpers.js";

describe("makeTranches", () => {
  it("makeResolvedTranches aligns dates and amounts", () => {
    const out = makeResolvedTranches(
      ["2024-01-01", "2024-02-01"] as OCTDate[],
      [3, 7],
    );
    expect(out).toEqual([
      { amount: 3, date: "2024-01-01" as OCTDate, meta: { state: "RESOLVED" } },
      { amount: 7, date: "2024-02-01" as OCTDate, meta: { state: "RESOLVED" } },
    ]);
  });

  it("makeStartPlusTranches steps are index * stepLength", () => {
    const out = makeStartPlusTranches([1, 1, 1], "MONTHS", 3, [
      { type: "DATE_NOT_YET_OCCURRED", date: "2024-02-01" as OCTDate },
    ]);
    expect(out.map((t) => t.meta.date)).toEqual([
      { type: "START_PLUS", unit: "MONTHS", steps: 0 },
      { type: "START_PLUS", unit: "MONTHS", steps: 3 },
      { type: "START_PLUS", unit: "MONTHS", steps: 6 },
    ]);
    expect(out[0].meta.blockers).toContain("DATE 2024-02-01"); // stringified via blockerToString
  });

  it("makeImpossibleTranches repeats blockers and amounts", () => {
    const blockers: ImpossibleBlocker[] = [
      makeImpossibleConditionBlocker(
        makeVestingBaseDate("2025-01-01" as OCTDate),
      ),
    ];
    const out = makeImpossibleTranches([5, 6], blockers);
    expect(out).toHaveLength(2);
    expect(out[0].meta.state).toBe("IMPOSSIBLE");
    expect(out[1].meta.blockers).toBe("DATE 2025-01-01");
  });

  it("before vesting start + before cliff use proper date meta", () => {
    expect(makeBeforeVestingStartTranche(5, [])).toMatchObject({
      meta: { date: { type: "BEFORE_VESTING_START" } },
    });
    expect(
      makeBeforeCliffTranche("2024-03-01" as OCTDate, 5, []),
    ).toMatchObject({
      meta: {
        date: { type: "MAYBE_BEFORE_CLIFF", date: "2024-03-01" as OCTDate },
      },
    });
  });
});
