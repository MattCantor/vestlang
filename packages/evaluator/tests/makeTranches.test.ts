import { describe, it, expect } from "vitest";
import {
  makeImpossibleSchedule,
  makeStartPlusSchedule,
  makeUnresolvedVestingStartSchedule,
  makeUnresolvedCliffInstallment,
} from "../src/interpret/makeTranches.js";
import {
  ImpossibleBlocker,
  DEFAULT_VESTING_DAY_OF_MONTH,
} from "@vestlang/types";
import {
  addPeriod,
  allocateVector,
  foldToGrantDate,
  gridDate,
} from "@vestlang/core";
import {
  makeVestingBaseDate,
  makeImpossibleConditionBlocker,
} from "./helpers.js";

describe("makeTranches", () => {
  it("makeStartPlusTranches steps are (index + 1) * stepLength", () => {
    const out = makeStartPlusSchedule([1, 1, 1], "MONTHS", 3, [
      { type: "EVENT_NOT_YET_OCCURRED", event: "milestone" },
    ]);
    const symbolic = out.installments.map((t) =>
      t.state === "UNRESOLVED" ? t.symbolicDate : undefined,
    );
    expect(symbolic).toEqual([
      { type: "START_PLUS", unit: "MONTHS", steps: 3 },
      { type: "START_PLUS", unit: "MONTHS", steps: 6 },
      { type: "START_PLUS", unit: "MONTHS", steps: 9 },
    ]);
    // The structured blockers ride beside the installments, naming the event.
    expect(out.blockers).toContainEqual({
      type: "EVENT_NOT_YET_OCCURRED",
      event: "milestone",
    });
  });

  // A START_PLUS installment carries only {unit, steps} — the count of periods
  // past whatever start eventually pins. When the start lands on/after the grant
  // date, no grant-date fold collapses any tranche, so the symbolic preview must
  // reconstruct date-for-date to the grid the resolved schedule would lay down:
  // applying `steps` periods to the start reproduces the j-th grid occurrence.
  it("steps reconstruct the resolved grid when no grant-date fold applies", () => {
    const unit = "MONTHS";
    const period = 3;
    const occurrences = 8;
    const start = "2025-06-15"; // on/after the grant date below
    const grantDate = "2025-01-01";
    const origin = start; // self-anchored statement: origin is its own start
    const dom = DEFAULT_VESTING_DAY_OF_MONTH;

    const amounts = allocateVector(800, occurrences);
    const out = makeStartPlusSchedule(amounts, unit, period, []);

    const at = gridDate({
      anchor: start,
      origin,
      period,
      periodType: unit,
      dom,
    });
    const gridDates = Array.from({ length: occurrences }, (_, i) => at(i + 1));

    // Precondition: the start is on/after the grant date, so folding to the grant
    // date is a no-op — every grid date survives unchanged. The reconstruction
    // claim below only holds in this no-fold case (START_PLUS can't encode a fold).
    const folded = foldToGrantDate(gridDates, amounts, grantDate);
    expect(folded.dates).toEqual(gridDates);

    out.installments.forEach((inst, i) => {
      expect(inst.state).toBe("UNRESOLVED");
      if (inst.state !== "UNRESOLVED") return;
      expect(inst.symbolicDate.type).toBe("START_PLUS");
      if (inst.symbolicDate.type !== "START_PLUS") return;
      const reconstructed = addPeriod(
        start,
        inst.symbolicDate.steps,
        inst.symbolicDate.unit,
        dom,
        origin,
      );
      expect(reconstructed).toBe(gridDates[i]);
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
