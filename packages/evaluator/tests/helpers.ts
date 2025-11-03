import {
  AndCondition,
  AtomCondition,
  Blocker,
  Condition,
  Constraint,
  ConstraintTag,
  Duration,
  EvaluationContext,
  ImpossibleBlocker,
  OCTDate,
  Offsets,
  OffsetTag,
  OrCondition,
  PeriodTag,
  ResolvedNode,
  Schedule,
  TwoOrMore,
  UnresolvedNode,
  VestingBaseDate,
  VestingBaseEvent,
  VestingNode,
  VestingPeriod,
} from "@vestlang/types";

export const baseCtx = (
  overrides: Partial<EvaluationContext> = {},
): EvaluationContext => ({
  events: { grantDate: "2025-01-01" as OCTDate },
  vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
  grantQuantity: 100,
  asOf: "2025-06-01" as OCTDate,
  allocation_type: "CUMULATIVE_ROUND_DOWN",
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
  base: VestingBaseDate | VestingBaseEvent,
  offsets: Offsets = [],
): VestingNode => ({
  type: "SINGLETON",
  base,
  offsets,
});

export const makeConstraint = (
  type: ConstraintTag,
  base: VestingNode,
  strict: boolean = false,
): Constraint => ({
  type,
  base,
  strict,
});

export const makeImpossibleConditionBlocker = (
  base: VestingBaseDate | VestingBaseEvent,
  offsets: Offsets = [],
): Extract<ImpossibleBlocker, { type: "IMPOSSIBLE_CONDITION" }> => {
  const { type, ...rest } = makeSingletonNode(base, offsets);
  return {
    type: "IMPOSSIBLE_CONDITION",
    condition: rest,
  };
};

export const makeAtomCondition = (constraint: Constraint): AtomCondition => ({
  type: "ATOM",
  constraint,
});

export const makeAndCondition = (
  items: TwoOrMore<Condition>,
): AndCondition => ({
  type: "AND",
  items,
});

export const makeOrCondtion = (items: TwoOrMore<Condition>): OrCondition => ({
  type: "OR",
  items,
});

export const makeConstrainedNodeWithAtomCondition = (
  constraintTag: ConstraintTag,
  baseDate: OCTDate,
  constraintBaseDate: OCTDate,
  strict: boolean = false,
  offsets: Offsets = [],
): VestingNode & { constraints: AtomCondition } => {
  return {
    type: "SINGLETON",
    base: makeVestingBaseDate(baseDate),
    constraints: makeAtomCondition(
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
  type: "SINGLETON",
  vesting_start,
  periodicity,
});
