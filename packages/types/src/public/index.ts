/* ------------------------
 * Enums
 * ------------------------ */

import type {
  EarlierOf,
  LaterOf,
  OCTDate,
  TwoOrMore,
} from "../shared-internal/index.js";

// enums/TemporalConstraintType.schema.json
export type ConstraintTag = "BEFORE" | "AFTER";

// enums/VestingBaseType.schema.json
export type VBaseTag = "DATE" | "EVENT";

// NOTE: this doesn't need a schema because it is eliminated by the normalizer
export type VNodeTag = "BARE" | "CONSTRAINED";

// enums/VestlangExpressionType.schema.json
export type ExprTag = "SINGLETON" | "EARLIER_OF" | "LATER_OF";

// enums/PeriodType.schema.json
// existing OCT schema
export type PeriodTag = "DAYS" | "MONTHS";

// enums/OffsetType.schema.json
// TODO: add this schema
export type OffsetTag = "PLUS" | "MINUS";

// enums/ConditionType.schema.json
// TODO: add this schema
export type ConditionTag = "ATOM" | "AND" | "OR";

// NOTE: this might have an existing schema
export type AmountTag = "PORTION" | "QUANTITY";

/* ------------------------
 * Durations
 * ------------------------ */

// types/vestlang/CliffDuration.schema.json
export interface Duration {
  type: "DURATION";
  value: number;
  unit: PeriodTag;
  sign: OffsetTag;
}

export interface DurationMonth extends Duration {
  unit: "MONTHS";
}

export interface DurationDay extends Duration {
  unit: "DAYS";
}

/* ------------------------
 * Offsets
 * ------------------------ */

export type Offsets =
  | []
  | [DurationMonth | DurationDay]
  | [DurationMonth, DurationDay];

/* ------------------------
 * Vesting Base
 * ------------------------ */

// primitives/vestlang/VestingBase.schema.json
export interface VestingBase {
  type: VBaseTag;
  value: string;
}

// types/vestlang/VestingBaseDate.schema.json
export interface VestingBaseDate extends VestingBase {
  type: "DATE";
  value: OCTDate;
}

// types/vestlang/VestingBaseEvent.schema.json
export interface VestingBaseEvent extends VestingBase {
  type: "EVENT";
  value: string;
}

/* ------------------------
 * Vesting Node
 * ------------------------ */

// primitives/types/vestlang/VestingNode.schema.json
export interface VestingNode {
  type: VNodeTag;
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Offsets;
}

// types/vestlang/BareVestingNode.schema.json
export interface BareVestingNode extends VestingNode {
  type: "BARE";
}

// types/vestlang/BareVestingNode.schema.json
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

// TODO: add to schema
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

// TODO: add to schmea
export type LaterOfVestingNode = LaterOf<VestingNode>;
export type EarlierOfVestingNode = EarlierOf<VestingNode>;

// TODO: add to schema
export interface Schedule {
  type: "SINGLETON";
  vesting_start: VestingNode | LaterOfVestingNode | EarlierOfVestingNode;
  periodicity: VestingPeriod;
}

// TODO: add to schema
export type LaterOfSchedule = LaterOf<Schedule>;
export type EarlierOfSchedule = EarlierOf<Schedule>;

/* ------------------------
 * Statements
 * ------------------------ */

export type BaseAmount = {
  type: AmountTag;
};
export interface AmountQuantity extends BaseAmount {
  type: "QUANTITY";
  value: number;
}
export interface AmountPortion extends BaseAmount {
  type: "PORTION";
  numerator: number;
  denominator: number;
}
export type Amount = AmountQuantity | AmountPortion;

export interface Statement {
  amount: Amount;
  expr: Schedule | LaterOfSchedule | EarlierOfSchedule;
}

export type Program = Statement[];
