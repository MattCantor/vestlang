---
title: Types
sidebar_position: 4
---

## Helpers

```ts
type TwoOrMore<T> = [T, T, ...T[]];

type SelectorTag = "EARLIER_OF" | "LATER_OF";

interface Selector<T, K extends SelectorTag = SelectorTag> {
  type: K;
  items: TwoOrMore<T>;
}

interface EarlierOf<T> extends Selector<T, "EARLIER_OF"> {}

interface LaterOf<T> extends Selector<T, "LATER_OF"> {}

declare const __isoDateBrand: unique symbol;
export type OCTDate = string & { [__isoDateBrand]: never };
```

## Enums

```ts
type ConstraintTag = "BEFORE" | "AFTER";

type VBaseTag = "DATE" | "EVENT";

type ExprTag = "SINGLETON" | "EARLIER_OF" | "LATER_OF";

type PeriodTag = "DAYS" | "MONTHS";

type OffsetTag = "PLUS" | "MINUS";

type ConditionTag = "ATOM" | "AND" | "OR";

type AmountTag = "PORTION" | "QUANTITY";
```

## AST

```ts
// "raw" refers to output from the DSL; "canonical" refers to after normalization
type Shape = "raw" | "canonical";

/* ------------------------
 * Durations
 * ------------------------ */

interface Duration {
  type: "DURATION";
  value: number;
  unit: PeriodTag;
  sign: OffsetTag;
}

interface DurationMonth extends Duration {
  unit: "MONTHS";
}

interface DurationDay extends Duration {
  unit: "DAYS";
}

/* ------------------------
 * Offsets
 * ------------------------ */

type Offsets =
  | readonly []
  | readonly [DurationMonth | DurationDay]
  | readonly [DurationMonth, DurationDay];

/* ------------------------
 * Vesting Base
 * ------------------------ */

interface VestingBase {
  type: VBaseTag;
  value: string;
}

interface VestingBaseDate extends VestingBase {
  type: "DATE";
  value: OCTDate;
}

interface VestingBaseEvent extends VestingBase {
  type: "EVENT";
  value: string;
}

/* ------------------------
 * Vesting Node
 * ------------------------ */

interface VestingNode {
  type: "SINGLETON";
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Offsets;
  constraints?: Condition;
}

type ConstrainedVestingNode = VestingNode & {
  constraints: Condition;
};

type LaterOfVestingNode = LaterOf<VestingNodeExpr>;

type EarlierOfVestingNode = EarlierOf<VestingNodeExpr>;

type VestingNodeExpr = VestingNode | LaterOfVestingNode | EarlierOfVestingNode;

/* ------------------------
 * Conditions & Constraints
 * ------------------------ */

interface BaseCondition {
  type: ConditionTag;
}

interface AtomCondition extends BaseCondition {
  type: "ATOM";
  constraint: Constraint;
}

interface AndCondition extends BaseCondition {
  type: "AND";
  items: TwoOrMore<Condition>;
}

interface OrCondition extends BaseCondition {
  type: "OR";
  items: TwoOrMore<Condition>;
}

type Condition = AtomCondition | AndCondition | OrCondition;

interface Constraint {
  type: ConstraintTag;
  base: VestingNode;
  strict: boolean;
}

/* ------------------------
 * Periodicity
 * ------------------------ */

interface VestingPeriod<S extends Shape = "canonical"> {
  type: PeriodTag;
  occurrences: number;
  length: number;
  cliff?: S extends "canonical"
    ? VestingNodeExpr | undefined
    : Duration | VestingNodeExpr | undefined;
}

type RawVestingPeriod = VestingPeriod<"raw">;

/* ------------------------
 * Expressions
 * ------------------------ */

interface Schedule<S extends Shape = "canonical"> {
  type: "SINGLETON";
  vesting_start: S extends "canonical"
    ? VestingNodeExpr
    : VestingNodeExpr | null;
  periodicity: VestingPeriod<S>;
}

type RawSchedule = Schedule<"raw">;

type LaterOfSchedule<S extends Shape = "canonical"> = LaterOf<ScheduleExpr<S>>;

type EarlierOfSchedule<S extends Shape = "canonical"> = EarlierOf<
  ScheduleExpr<S>
>;

type ScheduleExpr<S extends Shape = "canonical"> =
  | Schedule<S>
  | LaterOfSchedule<S>
  | EarlierOfSchedule<S>;

type RawScheduleExpr = ScheduleExpr<"raw">;

/* ------------------------
 * Statements
 * ------------------------ */

type BaseAmount = {
  type: AmountTag;
};

interface AmountQuantity extends BaseAmount {
  type: "QUANTITY";
  value: number;
}

interface AmountPortion extends BaseAmount {
  type: "PORTION";
  numerator: number;
  denominator: number;
}

type Amount = AmountQuantity | AmountPortion;

interface Statement<S extends Shape = "canonical"> {
  amount: Amount;
  expr: ScheduleExpr<S>;
}

type RawStatement = Statement<"raw">;

type Program<S extends Shape = "canonical"> = Statement<S>[];

type RawProgram = Program<"raw">;
```

## Evaluation

```ts
interface EvaluationContext {
  events: { grantDate: OCTDate } & Record<string, OCTDate | undefined>;
  grantQuantity: number;
  asOf: OCTDate;
  vesting_day_of_month: vesting_day_of_month;
  allocation_type: allocation_type;
}

type EvaluationContextInput = Omit<EvaluationContext, "vesting_day_of_month"> &
  Partial<Pick<EvaluationContext, "vesting_day_of_month" | "allocation_type">>;

type SymbolicDate =
  | { type: "START_PLUS"; unit: PeriodTag; steps: number }
  | { type: "BEFORE_VESTING_START" }
  | { type: "MAYBE_BEFORE_CLIFF"; date: OCTDate };

/* ------------------------
 * Blockers
 * ------------------------ */

type UnresolvedBlocker =
  | {
      type: "EVENT_NOT_YET_OCCURRED";
      event: string;
    }
  | {
      type: "UNRESOLVED_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: Blocker[];
    }
  | {
      type: "DATE_NOT_YET_OCCURRED";
      date: OCTDate;
    }
  | {
      type: "UNRESOLVED_CONDITION";
      condition: Omit<VestingNode, "type">;
    };

type ImpossibleBlocker =
  | {
      type: "IMPOSSIBLE_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: ImpossibleBlocker[];
    }
  | {
      type: "IMPOSSIBLE_CONDITION";
      condition: Omit<VestingNode, "type">;
    };

type Blocker = UnresolvedBlocker | ImpossibleBlocker;

/* ------------------------
 * Node Meta
 * ------------------------ */

type NodeResolutionState = "IMPOSSIBLE" | "UNRESOLVED" | "RESOLVED";

type ResolvedNode = {
  type: "RESOLVED";
  date: OCTDate;
};

type UnresolvedNode = {
  type: "UNRESOLVED";
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[];
};

type ImpossibleNode = {
  type: "IMPOSSIBLE";
  blockers: ImpossibleBlocker[];
};

type NodeMeta = ResolvedNode | UnresolvedNode | ImpossibleNode;

/* ------------------------
 * Tranche
 * ------------------------ */

interface TrancheMeta {
  index?: number;
  state: NodeResolutionState;
  date?: SymbolicDate;
  // blockers?: Blocker[];
  blockers?: string;
}

interface BaseTranche {
  amount: number;
  date?: OCTDate;
  meta: TrancheMeta;
}

interface ImpossibleTranche extends BaseTranche {
  amount: number;
  date?: never;
  meta: {
    state: "IMPOSSIBLE";
    date?: never;
    blockers: string;
  };
}

interface UnresolvedTranche extends BaseTranche {
  date?: never;
  meta: {
    state: "UNRESOLVED";
    date: SymbolicDate;
    blockers: string;
  };
}

interface ResolvedTranche extends BaseTranche {
  date: OCTDate;
  meta: {
    state: "RESOLVED";
    date?: never;
    blockers?: never;
  };
}

type Tranche = ImpossibleTranche | UnresolvedTranche | ResolvedTranche;
```
