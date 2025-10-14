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

// enums/Offset.schema.json
// TODO: add this schema
export type OffsetTag = "PLUS" | "MINUS";

// NOTE: This might not need a schema
export type ConditionTag = "ATOM" | "AND" | "OR";

// NOTE: this might have an existing schema
export type AmountTag = "PORTION" | "QUANTITY";

// ==== Helpers ====
export type TwoOrMore<T> = [T, T, ...T[]];

export type SelectorTag = "EARLIER_OF" | "LATER_OF";

export interface Selector<T, K extends SelectorTag = SelectorTag> {
  type: K;
  items: TwoOrMore<T>;
}

export interface EarlierOf<T> extends Selector<T, "EARLIER_OF"> {}

export interface LaterOf<T> extends Selector<T, "LATER_OF"> {}

/* ------------------------
 * OCT Types
 * ------------------------ */

// types/Date.schema.json
// existing OCT schema
declare const __isoDateBrand: unique symbol;
export type OCTDate = string & { [__isoDateBrand]: never };

/* ------------------------
 * Statement
 * ------------------------ */

export interface ASTStatement {
  amount: Amount;
  expr: ASTExpr;
}

/* ------------------------
 * Amounts
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

/* ------------------------
 * Expressions
 * ------------------------ */

export interface ASTExpr {
  type: ExprTag;
}

export interface EarlierOfASTExpr extends ASTExpr {
  type: "EARLIER_OF";
  items: TwoOrMore<AnyASTExpr>;
}

export interface LaterOfASTExpr extends ASTExpr {
  type: "LATER_OF";
  items: TwoOrMore<AnyASTExpr>;
}

// export type ASTExprSelector = EarlierOfASTExpr | LaterOfASTExpr;

export interface ASTSchedule extends ASTExpr {
  type: "SINGLETON";
  vesting_start: FromExpr;
  periodicity: ASTVestingPeriod;
}

export type AnyASTExpr = ASTSchedule | EarlierOfASTExpr | LaterOfASTExpr;

/* ------------------------
 * Durations
 * ------------------------ */

// types/vestlang/CliffDuration.schema.json
export interface Duration {
  type: "DURATION";
  value: number;
  unit: PeriodTag; // grammar converts weeks->days, years->months
  sign?: OffsetTag;
}

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
// TODO: update schema - include offsets
export interface VestingNode {
  type: VNodeTag;
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Duration[];
}

// types/vestlang/VestingNodeBare.schema.json
export interface VestingNodeBare extends VestingNode {
  type: "BARE";
}

// types/vestlang/VestingNodeConstrained.schema.json
// TODO: update this schema
export interface VestingNodeConstrained extends VestingNode {
  type: "CONSTRAINED";
  constraints: AnyCondition;
}

/* ------------------------
 * Conditions
 * ------------------------ */

// NOTE: this might not need any schema
export interface ASTCondition {
  type: ConditionTag;
}

export interface ConditionAtom extends ASTCondition {
  type: "ATOM";
  constraint: TemporalConstraint;
}

export interface ConditionAndGroup extends ASTCondition {
  type: "AND";
  items: TwoOrMore<AnyCondition>;
}

export interface ConditionOrGroup extends ASTCondition {
  type: "OR";
  items: TwoOrMore<AnyCondition>;
}

export type AnyCondition = ConditionAtom | ConditionAndGroup | ConditionOrGroup;

/* ------------------------
 * Constraints
 * ------------------------ */

// primitives/types/vestlang/TemporalConstraint.schema.json
export interface TemporalConstraint {
  type: ConstraintTag;
  base: VestingNode;
  strict: boolean;
}

// types/vestlang/TemporalConstraintAfter.schema.json
export interface TemporalConstraintAfter extends TemporalConstraint {
  type: "AFTER";
}

// types/vestlang/TemporalConstraintBefore.schema.json
export interface TemporalConstraintBefore extends TemporalConstraint {
  type: "BEFORE";
}

// types/vestlang/TemporalConstraintOrGroup
// TODO: remove corresponding json schema
// export interface TemporalConstraintOrGroup {
//   type: "OR";
//   items: TwoOrMore<TemporalConstraint>;
// }

export type FromEarlierOf = EarlierOf<FromExpr>;
export type FromLaterOf = LaterOf<FromExpr>;

export type FromExpr = VestingNode | FromEarlierOf | FromLaterOf;

/* ------------------------
 * Periodicity
 * ------------------------ */

// NOTE: mimics existing OCT schema types/vesting/VestingPeriod, without `Integer` types
interface ASTVestingPeriod {
  type: PeriodTag;
  occurrences: number; // the installment count
  length: number; // the installment step
  cliff?: CliffExpr;
}

export type CliffEarlierOf = EarlierOf<CliffExpr>;
export type CliffLaterOf = LaterOf<CliffExpr>;
export type CliffExpr = VestingNode | CliffEarlierOf | CliffLaterOf;
