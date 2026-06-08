import {
  AtomCondition,
  Blocker,
  Constraint,
  ConstraintTag,
  Duration,
  EvaluationContext,
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
  VestingPeriod,
} from "@vestlang/types";

export const baseCtx = (
  overrides: Partial<EvaluationContext> = {},
): EvaluationContext => ({
  grantDate: "2025-01-01",
  events: {},
  vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
  grantQuantity: 100,
  asOf: "2025-06-01",
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

export const makeSingletonNode = (
  base: VestingBase,
  offsets: Offsets = [],
): VestingNode => ({
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
): Extract<ImpossibleBlocker, { type: "IMPOSSIBLE_CONDITION" }> => {
  const { type: _type, ...rest } = makeSingletonNode(base, offsets);
  return {
    type: "IMPOSSIBLE_CONDITION",
    condition: rest,
  };
};

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

export const makeResolvedNode = (date: OCTDate): ResolvedNode => ({
  type: "RESOLVED",
  date,
});

export const makeUnresolvedNode = (...blockers: Blocker[]): UnresolvedNode => ({
  type: "UNRESOLVED",
  blockers,
});

export const makeSingletonSchedule = (
  vesting_start: VestingNode,
  periodicity: VestingPeriod,
): Schedule => ({
  type: "SCHEDULE",
  vesting_start,
  periodicity,
});
