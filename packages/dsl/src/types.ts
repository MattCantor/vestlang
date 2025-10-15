/* ------------------------
 * Enums
 * ------------------------ */

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
  vesting_start: ASTFromExpr;
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
  sign: OffsetTag;
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

export interface ASTNode {
  type: VNodeTag;
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Duration[];
}

export interface ASTNodeBare extends ASTNode {
  type: "BARE";
}

export interface ASTNodeConstrained extends ASTNode {
  type: "CONSTRAINED";
  constraints: AnyCondition;
}

/* ------------------------
 * Conditions
 * ------------------------ */

// primitives/types/vestlang/Condition.schema.json
// TODO: add this schema
export interface BaseCondition {
  type: ConditionTag;
}

export interface ConditionAtom extends BaseCondition {
  type: "ATOM";
  constraint: TemporalConstraint;
}

export interface ConditionAndGroup extends BaseCondition {
  type: "AND";
  items: TwoOrMore<AnyCondition>;
}

export interface ConditionOrGroup extends BaseCondition {
  type: "OR";
  items: TwoOrMore<AnyCondition>;
}

export type AnyCondition = ConditionAtom | ConditionAndGroup | ConditionOrGroup;

/* ------------------------
 * Constraints
 * ------------------------ */

export interface TemporalConstraint {
  type: ConstraintTag;
  base: ASTNode;
  strict: boolean;
}

export interface TemporalConstraintAfter extends TemporalConstraint {
  type: "AFTER";
}

export interface TemporalConstraintBefore extends TemporalConstraint {
  type: "BEFORE";
}

// TODO: remove corresponding json schema
// export interface TemporalConstraintOrGroup {
//   type: "OR";
//   items: TwoOrMore<TemporalConstraint>;
// }

export type ASTFromEarlierOf = EarlierOf<ASTFromExpr>;
export type ASTFromLaterOf = LaterOf<ASTFromExpr>;

export type ASTFromExpr = ASTNode | ASTFromEarlierOf | ASTFromLaterOf;

/* ------------------------
 * Periodicity
 * ------------------------ */

// NOTE: mimics existing OCT schema types/vesting/VestingPeriod, without `Integer` types
interface ASTVestingPeriod {
  type: PeriodTag;
  occurrences: number; // the installment count
  length: number; // the installment step
  cliff?: ASTCliffExpr;
}

export type ASTCliffEarlierOf = EarlierOf<ASTCliffExpr>;
export type ASTCliffLaterOf = LaterOf<ASTCliffExpr>;
export type ASTCliffExpr = ASTNode | ASTCliffEarlierOf | ASTCliffLaterOf;
