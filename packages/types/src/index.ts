/* ------------------------
 * Helpers
 * ------------------------ */

type TwoOrMore<T> = [T, T, ...T[]];

type SelectorTag = "EARLIER_OF" | "LATER_OF";

interface Selector<T, K extends SelectorTag = SelectorTag> {
  type: K;
  items: TwoOrMore<T>;
}

interface EarlierOf<T> extends Selector<T, "EARLIER_OF"> {}

interface LaterOf<T> extends Selector<T, "LATER_OF"> {}

type Shape = "raw" | "canonical";

// types/Date.schema.json
// existing OCT schema
declare const __isoDateBrand: unique symbol;
type OCTDate = string & { [__isoDateBrand]: never };

/* ------------------------
 * Enums
 * ------------------------ */

// enums/TemporalConstraintType.schema.json
export type ConstraintTag = "BEFORE" | "AFTER";

// enums/VestingBaseType.schema.json
export type VBaseTag = "DATE" | "EVENT";

// enums/VestingNodeType.schema.json
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
export interface VestingNode<S extends Shape = "canonical"> {
  type: VNodeTag;
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Offsets;
  constraints?: Condition<S>;
}

// types/vestlang/BareVestingNode.schema.json
export interface BareVestingNode extends VestingNode {
  type: "BARE";
  constraints?: never;
}

// types/vestlang/BareVestingNode.schema.json
export interface ConstrainedVestingNode<S extends Shape = "canonical">
  extends VestingNode<S> {
  type: "CONSTRAINED";
  constraints: Condition<S>;
}

export type RawConstrainedVestingNode = ConstrainedVestingNode<"raw">;

// TODO: add to schmea
export type LaterOfVestingNode<S extends Shape = "canonical"> = LaterOf<
  VestingNode<S>
>;

export type RawLaterOfVestingNode = LaterOfVestingNode<"raw">;

export type EarlierOfVestingNode<S extends Shape = "canonical"> = EarlierOf<
  VestingNode<S>
>;

export type RawEarlierOfVestingNode = EarlierOfVestingNode<"raw">;

export type RawVestingNode = VestingNode<"raw">;

export type VestingNodeExpr<S extends Shape = "canonical"> =
  | VestingNode<S>
  | LaterOfVestingNode<S>
  | EarlierOfVestingNode<S>;

export type RawVestingNodeExpr = VestingNodeExpr<"raw">;

/* ------------------------
 * Conditions & Constraints
 * ------------------------ */

export interface BaseCondition {
  type: ConditionTag;
}

// TODO: add to schema
export interface AtomCondition<S extends Shape = "canonical">
  extends BaseCondition {
  type: "ATOM";
  constraint: S extends "canonical"
    ? Omit<Constraint, "base"> & { base: BareVestingNode }
    : Constraint<S>;
}

export type RawAtomCondition = AtomCondition<"raw">;

// TODO: add to schema
export interface AndCondition<S extends Shape = "canonical">
  extends BaseCondition {
  type: "AND";
  items: TwoOrMore<Condition<S>>;
}

export type RawAndCondition = AndCondition<"raw">;

// TODO: add to schema
export interface OrCondition<S extends Shape = "canonical">
  extends BaseCondition {
  type: "OR";
  items: TwoOrMore<Condition<S>>;
}

export type RawOrCondition = OrCondition<"raw">;

export type Condition<S extends Shape = "canonical"> =
  | AtomCondition<S>
  | AndCondition<S>
  | OrCondition<S>;

export type RawCondition = Condition<"raw">;

// TODO: add to schema
export interface Constraint<S extends Shape = "canonical"> {
  type: ConstraintTag;
  base: BareVestingNode | ConstrainedVestingNode<S>;
  strict: boolean;
}

/* ------------------------
 * Periodicity
 * ------------------------ */

export interface VestingPeriod<S extends Shape = "canonical"> {
  type: PeriodTag;
  occurrences: number;
  length: number;
  cliff?: VestingNodeExpr<S>;
}

export type RawVestingPeriod = VestingPeriod<"raw">;

/* ------------------------
 * Expressions
 * ------------------------ */

// TODO: add to schema
export interface Schedule<S extends Shape = "canonical"> {
  type: "SINGLETON";
  vesting_start: VestingNodeExpr<S>;
  periodicity: VestingPeriod<S>;
}

export type RawSchedule = Schedule<"raw">;

// TODO: add to schema
export type LaterOfSchedule<S extends Shape = "canonical"> = LaterOf<
  Schedule<S>
>;

export type RawLaterOfSchedule = LaterOfSchedule<"raw">;

export type EarlierOfSchedule<S extends Shape = "canonical"> = EarlierOf<
  Schedule<S>
>;

export type RawEarlierOfSchedule = EarlierOfSchedule<"raw">;

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
