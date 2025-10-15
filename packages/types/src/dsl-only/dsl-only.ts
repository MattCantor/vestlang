/* ------------------------
 * Durations
 * ------------------------ */

import type {
  Amount,
  ConditionTag,
  ConstraintTag,
  Duration,
  PeriodTag,
  VestingBaseDate,
  VestingBaseEvent,
  VNodeTag,
} from "../public/index.js";
import type {
  EarlierOf,
  LaterOf,
  TwoOrMore,
} from "../shared-internal/index.js";

/* ------------------------
 * Vesting Node
 * ------------------------ */

export interface VestingNode {
  type: VNodeTag;
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Duration[];
}

export interface BareVestingNode extends VestingNode {
  type: "BARE";
}

export interface ConstrainedVestingNode extends VestingNode {
  type: "CONSTRAINED";
  constraints: Condition;
}

/* ------------------------
 * Conditions & Constraints
 * ------------------------ */

export interface BaseCondition {
  type: ConditionTag;
}

export interface AtomCondition extends BaseCondition {
  type: "ATOM";
  constraint: Constraint;
}

// TODO: add to schema
export interface AndCondition extends BaseCondition {
  type: "AND";
  items: TwoOrMore<Condition>;
}

// TODO: add to schema
export interface OrCondition extends BaseCondition {
  type: "OR";
  items: TwoOrMore<Condition>;
}

export type Condition = AtomCondition | AndCondition | OrCondition;

// TODO: add to schema
export interface Constraint {
  type: ConstraintTag;
  base: VestingNode;
  strict: boolean;
}

/* ------------------------
 * Periodicity
 * ------------------------ */

export interface VestingPeriod {
  type: PeriodTag;
  occurrences: number;
  length: number;
  cliff?: VestingNode | LaterOfVestingNode | EarlierOfVestingNode;
}

/* ------------------------
 * Expressions
 * ------------------------ */

export type LaterOfVestingNode = LaterOf<VestingNode>;
export type EarlierOfVestingNode = EarlierOf<VestingNode>;

export interface Schedule {
  type: "SINGLETON";
  vesting_start: VestingNode | LaterOfVestingNode | EarlierOfVestingNode;
  periodicity: VestingPeriod;
}

export type LaterOfSchedule = LaterOf<Schedule>;
export type EarlierOfSchedule = EarlierOf<Schedule>;

/* ------------------------
 * Statements
 * ------------------------ */

export interface Statement {
  amount: Amount;
  expr: Schedule | LaterOfSchedule | EarlierOfSchedule;
}
