import {
  AmountTag,
  ConditionTag,
  ConstraintTag,
  OffsetTag,
  PeriodTag,
} from "./enums.js";
import { EarlierOf, LaterOf, OCTDate, TwoOrMore } from "./helpers.js";

// The DSL AST exists in two phases, tracked by this parameter:
//   "raw"        — straight off the parser: a vesting start may be null and a
//                  cliff may still be a bare Duration.
//   "normalized" — after the normalizer runs: starts are resolved to a node and
//                  cliffs to a VestingNodeExpr.
// "normalized" is the default, so the unparameterized types (Schedule, Program,
// …) describe the normalized shape and the Raw* aliases pin the raw phase.
//
// This is NOT the same "canonical" as ./canonical.ts. There, canonical means the
// OCF/Carta interchange — a different layer. Here we mean "normalized by our own
// normalizer," which is why the value is named accordingly.
type Phase = "raw" | "normalized";

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
// A vesting anchor: a calendar DATE or a named EVENT. Exported as the union so
// callers narrow on `type`; there is intentionally no wide `{ type: VBaseTag }`
// base type to annotate against (that would discard the discriminant).
export interface VestingBaseDate {
  type: "DATE";
  value: OCTDate;
}

export interface VestingBaseEvent {
  type: "EVENT";
  value: string;
}

export type VestingBase = VestingBaseDate | VestingBaseEvent;

/* ------------------------
 * Vesting Node
 * ------------------------ */

// primitives/types/vestlang/VestingNode.schema.json
export interface VestingNode {
  type: "SINGLETON";
  base: VestingBase;
  offsets: Offsets;
  condition?: Condition;
}

export type ConstrainedVestingNode = VestingNode & {
  condition: Condition;
};

export type LaterOfVestingNode = LaterOf<VestingNodeExpr>;

export type EarlierOfVestingNode = EarlierOf<VestingNodeExpr>;

export type VestingNodeExpr =
  | VestingNode
  | LaterOfVestingNode
  | EarlierOfVestingNode;

/* ------------------------
 * Conditions & Constraints
 * ------------------------ */

interface BaseCondition {
  type: ConditionTag;
}

export interface AtomCondition extends BaseCondition {
  type: "ATOM";
  constraint: Constraint;
}

export interface AndCondition extends BaseCondition {
  type: "AND";
  items: TwoOrMore<Condition>;
}

export interface OrCondition extends BaseCondition {
  type: "OR";
  items: TwoOrMore<Condition>;
}

export type Condition = AtomCondition | AndCondition | OrCondition;

export interface Constraint {
  type: ConstraintTag;
  // The reference anchor is a single VestingNode, never a VestingNodeExpr. A
  // BEFORE/AFTER relation needs one comparison point, so selectors
  // (EARLIER/LATER OF), which denote a set of candidate dates, are disallowed
  // here. Keeping it a plain node also bounds the evaluator: a node carries a
  // condition and a condition references a node, so admitting a selector here
  // would deepen that recursion.
  base: VestingNode;
  strict: boolean;
}

/* ------------------------
 * Periodicity
 * ------------------------ */

export interface VestingPeriod<P extends Phase = "normalized"> {
  type: PeriodTag;
  occurrences: number;
  length: number;
  cliff?: P extends "normalized"
    ? VestingNodeExpr | undefined
    : Duration | VestingNodeExpr | undefined;
}

export type RawVestingPeriod = VestingPeriod<"raw">;

/* ------------------------
 * Expressions
 * ------------------------ */

export interface Schedule<P extends Phase = "normalized"> {
  type: "SINGLETON";
  vesting_start: P extends "normalized"
    ? VestingNodeExpr
    : VestingNodeExpr | null;
  periodicity: VestingPeriod<P>;
}

export type RawSchedule = Schedule<"raw">;

export type LaterOfSchedule<P extends Phase = "normalized"> = LaterOf<
  ScheduleExpr<P>
>;

export type EarlierOfSchedule<P extends Phase = "normalized"> = EarlierOf<
  ScheduleExpr<P>
>;

export type ScheduleExpr<P extends Phase = "normalized"> =
  | Schedule<P>
  | LaterOfSchedule<P>
  | EarlierOfSchedule<P>;

export type RawScheduleExpr = ScheduleExpr<"raw">;

/* ------------------------
 * Statements
 * ------------------------ */

interface BaseAmount {
  type: AmountTag;
}
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

export interface Statement<P extends Phase = "normalized"> {
  amount: Amount;
  expr: ScheduleExpr<P>;
}

export type RawStatement = Statement<"raw">;

export type Program<P extends Phase = "normalized"> = Statement<P>[];

export type RawProgram = Program<"raw">;
