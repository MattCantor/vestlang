// Fixture builders for the presentation tests. These construct normalized AST
// nodes (bases, single-base nodes, schedules) the same way the evaluator's own
// test helpers do — kept local here so the pipeline tests don't reach into
// another package's test tree.
import type {
  Offsets,
  OCTDate,
  Schedule,
  VestingBase,
  VestingBaseDate,
  VestingBaseEvent,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";

export const makeVestingBaseDate = (value: OCTDate): VestingBaseDate => ({
  type: "DATE",
  value,
});

export const makeVestingBaseEvent = (value: string): VestingBaseEvent => ({
  type: "EVENT",
  value,
});

// The node carries its base's *exact* type, so it slots wherever that base is
// legal: a DATE/EVENT node fits a start or a cliff, a GRANT_DATE node only a
// start. A misplaced anchor is a type error at the fixture.
export const makeSingletonNode = <B extends VestingBase>(
  base: B,
  offsets: Offsets = [],
): VestingNode & { base: B } => ({
  type: "NODE",
  base,
  offsets,
});

export const makeSingletonSchedule = (
  vesting_start: VestingNodeExpr<"GRANT_DATE">,
  periodicity: VestingPeriod,
): Schedule => ({
  type: "SCHEDULE",
  vesting_start,
  periodicity,
});
