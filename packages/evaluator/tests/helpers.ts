import {
  AtomCondition,
  Blocker,
  Constraint,
  ConstraintTag,
  Duration,
  ResolutionContext,
  ImpossibleBlocker,
  OCTDate,
  Offsets,
  OffsetTag,
  PeriodTag,
  ResolvedNode,
  Schedule,
  UnresolvedNode,
  VestingBase,
  VestingBaseDate,
  VestingBaseEvent,
  VestingBaseGrantDate,
  VestingBaseVestingStart,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";

export const baseCtx = (
  overrides: Partial<ResolutionContext> = {},
): ResolutionContext => ({
  grantDate: "2025-01-01",
  events: {},
  vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
  grantQuantity: 100,
  ...overrides,
});

export const makeVestingBaseDate = (value: OCTDate): VestingBaseDate => ({
  type: "DATE",
  value,
});

export const makeVestingBaseEvent = (value: string): VestingBaseEvent => ({
  type: "EVENT",
  value,
});

export const makeVestingBaseGrantDate = (): VestingBaseGrantDate => ({
  type: "GRANT_DATE",
});

export const makeVestingBaseVestingStart = (): VestingBaseVestingStart => ({
  type: "VESTING_START",
});

export const makeDuration = (
  value: number,
  unit: PeriodTag,
  sign: OffsetTag,
): Duration => ({
  type: "DURATION",
  value,
  unit,
  sign,
});

// The node carries its base's *exact* type, so it slots wherever that base is
// legal: a DATE/EVENT node fits a start or a cliff, a GRANT_DATE node only a
// start, a VESTING_START node only a cliff. No anchor parameter to infer — a
// single-base node is structurally assignable to any slot union that admits the
// base — and a misplaced anchor (a GRANT_DATE node into a cliff) is a type error
// at the fixture, mirroring the positional invariant the source now enforces.
export const makeSingletonNode = <B extends VestingBase>(
  base: B,
  offsets: Offsets = [],
): VestingNode & { base: B } => ({
  type: "NODE",
  base,
  offsets,
});

const makeConstraint = (
  type: ConstraintTag,
  base: VestingNode,
  strict: boolean = false,
): Constraint => ({
  type,
  base,
  strict,
});

export const makeImpossibleConditionBlocker = (
  base: VestingBase,
  offsets: Offsets = [],
): Extract<ImpossibleBlocker, { type: "IMPOSSIBLE_CONDITION" }> => ({
  type: "IMPOSSIBLE_CONDITION",
  node: makeSingletonNode(base, offsets),
});

const makeAtomCondition = (constraint: Constraint): AtomCondition => ({
  type: "ATOM",
  constraint,
});

export const makeConstrainedNodeWithAtomCondition = (
  constraintTag: ConstraintTag,
  baseDate: OCTDate,
  constraintBaseDate: OCTDate,
  strict: boolean = false,
  offsets: Offsets = [],
): VestingNode & { condition: AtomCondition } => {
  return {
    type: "NODE",
    base: makeVestingBaseDate(baseDate),
    condition: makeAtomCondition(
      makeConstraint(
        constraintTag,
        makeSingletonNode(makeVestingBaseDate(constraintBaseDate)),
        strict,
      ),
    ),
    offsets,
  };
};

// A node on any base carrying a single BEFORE/AFTER gate. Unlike
// makeConstrainedNodeWithAtomCondition (which hardcodes a DATE subject), this
// takes the subject base and the constraint's reference node directly — needed
// for an event-anchored cliff gated against, say, grantDate + 12 months. Carries
// the base's exact type the way makeSingletonNode does, so an EVENT-anchored
// gated node still slots into a cliff (`VestingNodeExpr<"VESTING_START">`). The
// constraint's reference node stays a plain VestingNode — Constraint.base is
// positionally unparameterized, so a grant-date reference is legal there.
export const makeGatedNode = <B extends VestingBase>(
  base: B,
  constraintTag: ConstraintTag,
  constraintBase: VestingNode,
  strict: boolean = false,
  offsets: Offsets = [],
): VestingNode & { base: B; condition: AtomCondition } => ({
  type: "NODE",
  base,
  offsets,
  condition: makeAtomCondition(
    makeConstraint(constraintTag, constraintBase, strict),
  ),
});

export const makeResolvedNode = (date: OCTDate): ResolvedNode => ({
  type: "RESOLVED",
  date,
});

export const makeUnresolvedNode = (...blockers: Blocker[]): UnresolvedNode => ({
  type: "UNRESOLVED",
  blockers,
});

export const makeSingletonSchedule = (
  vesting_start: VestingNodeExpr<"GRANT_DATE">,
  periodicity: VestingPeriod,
): Schedule => ({
  type: "SCHEDULE",
  vesting_start,
  periodicity,
});
