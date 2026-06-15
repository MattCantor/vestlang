import { describe, it, expect } from "vitest";
import {
  makeImpossibleSchedule,
  makeStartPlusSchedule,
  makeUnresolvedVestingStartSchedule,
  makeUnresolvedCliffInstallment,
} from "../src/evaluate/makeTranches.js";
import { ImpossibleBlocker } from "@vestlang/types";
import {
  makeVestingBaseDate,
  makeImpossibleConditionBlocker,
} from "./helpers.js";

describe("makeTranches", () => {
  it("makeStartPlusTranches steps are index * stepLength", () => {
    const out = makeStartPlusSchedule([1, 1, 1], "MONTHS", 3, [
      { type: "EVENT_NOT_YET_OCCURRED", event: "milestone" },
    ]);
    const symbolic = out.installments.map((t) =>
      t.state === "UNRESOLVED" ? t.symbolicDate : undefined,
    );
    expect(symbolic).toEqual([
      { type: "START_PLUS", unit: "MONTHS", steps: 0 },
      { type: "START_PLUS", unit: "MONTHS", steps: 3 },
      { type: "START_PLUS", unit: "MONTHS", steps: 6 },
    ]);
    // The structured blockers ride beside the installments, naming the event.
    expect(out.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "milestone",
    });
  });

  it("makeImpossibleTranches repeats blockers and amounts", () => {
    const blockers: ImpossibleBlocker[] = [
      makeImpossibleConditionBlocker(makeVestingBaseDate("2025-01-01")),
    ];
    const out = makeImpossibleSchedule([5, 6], blockers);
    expect(out.installments).toHaveLength(2);
    expect(out.installments[0].state).toBe("IMPOSSIBLE");
    // The impossible-condition blocker rides beside the installments.
    expect(out.blockers).toEqual(blockers);
  });

  it("before vesting start + before cliff use proper date meta", () => {
    const unresolvedStart = makeUnresolvedVestingStartSchedule([5], []);
    const start = unresolvedStart.installments[0];
    const symbolicDate =
      start.state === "UNRESOLVED" ? start.symbolicDate : undefined;
    expect(symbolicDate).toMatchObject({ type: "UNRESOLVED_VESTING_START" });

    const unresolvedCliff = makeUnresolvedCliffInstallment("2024-03-01", 5);
    const symbolicDate2 = unresolvedCliff.symbolicDate;
    expect(symbolicDate2).toMatchObject({
      type: "UNRESOLVED_CLIFF",
      date: "2024-03-01",
    });
  });
});
