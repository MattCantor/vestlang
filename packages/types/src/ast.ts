import {
  AmountTag,
  ConditionTag,
  ConstraintTag,
  OffsetTag,
  PeriodTag,
  VBaseTag,
} from "./enums.js";
import { EarlierOf, LaterOf, OCTDate, TwoOrMore } from "./helpers.js";

type Shape = "raw" | "canonical";

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
  | readonly []
  | readonly [DurationMonth | DurationDay]
  | readonly [DurationMonth, DurationDay];

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
  type: "SINGLETON";
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Offsets;
  constraints?: Condition;
}

// TODO: add to schmea
export type LaterOfVestingNode = LaterOf<VestingNodeExpr>;

export type EarlierOfVestingNode = EarlierOf<VestingNodeExpr>;

export type VestingNodeExpr =
  | VestingNode
  | LaterOfVestingNode
  | EarlierOfVestingNode;

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

export interface VestingPeriod<S extends Shape = "canonical"> {
  type: PeriodTag;
  occurrences: number;
  length: number;
  cliff?: S extends "canonical"
    ? VestingNodeExpr | undefined
    : Duration | VestingNodeExpr | undefined;
}

export type RawVestingPeriod = VestingPeriod<"raw">;

/* ------------------------
 * Expressions
 * ------------------------ */

// TODO: add to schema
export interface Schedule<S extends Shape = "canonical"> {
  type: "SINGLETON";
  vesting_start: S extends "canonical"
    ? VestingNodeExpr
    : VestingNodeExpr | null;
  periodicity: VestingPeriod<S>;
}

export type RawSchedule = Schedule<"raw">;

// TODO: add to schema
export type LaterOfSchedule<S extends Shape = "canonical"> = LaterOf<
  ScheduleExpr<S>
>;

export type EarlierOfSchedule<S extends Shape = "canonical"> = EarlierOf<
  ScheduleExpr<S>
>;

export type ScheduleExpr<S extends Shape = "canonical"> =
  | Schedule<S>
  | LaterOfSchedule<S>
  | EarlierOfSchedule<S>;

export type RawScheduleExpr = ScheduleExpr<"raw">;

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

export interface Statement<S extends Shape = "canonical"> {
  amount: Amount;
  expr: ScheduleExpr<S>;
}

export type RawStatement = Statement<"raw">;

export type Program<S extends Shape = "canonical"> = Statement<S>[];

export type RawProgram = Program<"raw">;
