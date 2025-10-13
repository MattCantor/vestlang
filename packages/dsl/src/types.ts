import {
  AmountTypeEnum,
  ConstraintEnum,
  ConditionTypeEnum,
  ExprEnum,
  OffsetEnum,
  PeriodTypeEnum,
  VBaseEnum,
  VNodeEnum,
} from "./enums";

// ==== Helpers ====
export type TwoOrMore<T> = [T, T, ...T[]];

export type SelectorTag = ExprEnum.EARLIER_OF | ExprEnum.LATER_OF;

export interface Selector<T, K extends SelectorTag = SelectorTag> {
  type: K;
  items: TwoOrMore<T>;
}

export interface EarlierOf<T> extends Selector<T, ExprEnum.EARLIER_OF> {}

export interface LaterOf<T> extends Selector<T, ExprEnum.LATER_OF> {}

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
  type: AmountTypeEnum;
};

export interface AmountQuantity extends BaseAmount {
  type: AmountTypeEnum.QUANTITY;
  value: number;
}

export interface AmountPortion extends BaseAmount {
  type: AmountTypeEnum.PORTION;
  numerator: number;
  denominator: number;
}

export type Amount = AmountQuantity | AmountPortion;

/* ------------------------
 * Expressions
 * ------------------------ */

export interface ASTExpr {
  type: ExprEnum;
}

export interface EarlierOfASTExpr extends ASTExpr {
  type: ExprEnum.EARLIER_OF;
  items: TwoOrMore<AnyASTExpr>;
}

export interface LaterOfASTExpr extends ASTExpr {
  type: ExprEnum.LATER_OF;
  items: TwoOrMore<AnyASTExpr>;
}

// export type ASTExprSelector = EarlierOfASTExpr | LaterOfASTExpr;

export interface ASTSchedule extends ASTExpr {
  type: ExprEnum.SINGLETON;
  vesting_start: From;
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
  unit: PeriodTypeEnum; // grammar converts weeks->days, years->months
  sign?: OffsetEnum;
}

/* ------------------------
 * Vesting Base
 * ------------------------ */

// primitives/vestlang/VestingBase.schema.json
export interface VestingBase {
  type: VBaseEnum;
  value: string;
}

// types/vestlang/VestingBaseDate.schema.json
export interface VestingBaseDate extends VestingBase {
  type: VBaseEnum.DATE;
  value: OCTDate;
}

// types/vestlang/VestingBaseEvent.schema.json
export interface VestingBaseEvent extends VestingBase {
  type: VBaseEnum.EVENT;
  value: string;
}

/* ------------------------
 * Vesting Node
 * ------------------------ */

// primitives/types/vestlang/VestingNode.schema.json
// TODO: update schema - include offsets
export interface VestingNode {
  type: VNodeEnum;
  base: VestingBaseDate | VestingBaseEvent;
  offsets: Duration[];
}

// types/vestlang/VestingNodeBare.schema.json
export interface VestingNodeBare extends VestingNode {
  type: VNodeEnum.BARE;
}

// types/vestlang/VestingNodeConstrained.schema.json
// TODO: update this schema
export interface VestingNodeConstrained extends VestingNode {
  type: VNodeEnum.CONSTRAINED;
  constraints: AnyCondition;
}

/* ------------------------
 * Conditions
 * ------------------------ */

// NOTE: this might not need any schema
export interface ASTCondition {
  type: ConditionTypeEnum;
}

export interface ConditionAtom extends ASTCondition {
  type: ConditionTypeEnum.ATOM;
  constraint: TemporalConstraint;
}

export interface ConditionAndGroup extends ASTCondition {
  type: ConditionTypeEnum.AND;
  items: TwoOrMore<AnyCondition>;
}

export interface ConditionOrGroup extends ASTCondition {
  type: ConditionTypeEnum.OR;
  items: TwoOrMore<AnyCondition>;
}

export type AnyCondition = ConditionAtom | ConditionAndGroup | ConditionOrGroup;

/* ------------------------
 * Constraints
 * ------------------------ */

// primitives/types/vestlang/TemporalConstraint.schema.json
export interface TemporalConstraint {
  type: ConstraintEnum;
  base: VestingNode;
  strict: boolean;
}

// types/vestlang/TemporalConstraintAfter.schema.json
export interface TemporalConstraintAfter extends TemporalConstraint {
  type: ConstraintEnum.AFTER;
}

// types/vestlang/TemporalConstraintBefore.schema.json
export interface TemporalConstraintBefore extends TemporalConstraint {
  type: ConstraintEnum.BEFORE;
}

// types/vestlang/TemporalConstraintOrGroup
// TODO: remove corresponding json schema
// export interface TemporalConstraintOrGroup {
//   type: "OR";
//   items: TwoOrMore<TemporalConstraint>;
// }

export type From = VestingNode | EarlierOf<VestingNode> | LaterOf<VestingNode>;

/* ------------------------
 * Periodicity
 * ------------------------ */

// NOTE: mimics existing OCT schema types/vesting/VestingPeriod, without `Integer` types
interface ASTVestingPeriod {
  type: PeriodTypeEnum;
  occurrences: number; // the installment count
  length: number; // the installment step
  cliff?: Cliff;
}

export type Cliff = VestingNode | EarlierOf<VestingNode> | LaterOf<VestingNode>;
