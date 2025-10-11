import {
  ConstraintEnum,
  ExprEnum,
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
  amount: AstAmount;
  expr: ASTExpr;
}

/* ------------------------
 * Amounts
 * ------------------------ */

// enums/vestlang/AmountType
export type AmountType = "AmountPercent" | "AmountAbsolute";

export type BaseAmount = {
  type: AmountType;
};

export interface ASTAmountAbsolute extends BaseAmount {
  type: "AmountAbsolute";
  value: number; // whole shares
}

export interface ASTAmountPercent extends BaseAmount {
  type: "AmountPercent";
  value: number; // fraction in [0, 1]
}

export type AstAmount = ASTAmountAbsolute | ASTAmountPercent;

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
  from?: From | null;
  over: Duration;
  every: Duration;
  cliff?: Cliff;
}

export type AnyASTExpr = ASTSchedule | EarlierOfASTExpr | LaterOfASTExpr;

// ==== Durations (normalized by grammar) ====

// types/vestlang/CliffDuration.schema.json
export interface Duration {
  type: "DURATION";
  value: number;
  unit: PeriodTypeEnum; // grammar converts weeks->days, years->months
}

// ==== Vesting Base ====

// primitives/vestlang/VestingBase.schema.json
export interface VestingBase {
  type: VBaseEnum;
  value: string;
}

// export type BareAnchor = VestingBaseDate | VestingBaseEvent;

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

// === Vesting Node ===

// primitives/types/vestlang/VestingNode.schema.json
export interface VestingNode {
  type: VNodeEnum;
  base: VestingBaseDate | VestingBaseEvent;
}

// types/vestlang/VestingNodeBare.schema.json
export interface VestingNodeBare extends VestingNode {
  type: VNodeEnum.BARE;
}

// ==== Constraints ====

// primitives/types/vestlang/TemporalConstraint.schema.json
export interface TemporalConstraint {
  type: ConstraintEnum;
  base: VestingBaseDate | VestingBaseEvent;
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
export interface TemporalConstraintOrGroup {
  type: "OR";
  items: TwoOrMore<TemporalConstraint>;
}

export type Constraint = TemporalConstraint | TemporalConstraintOrGroup;

// types/vestlang/VestingNodeConstrained.schema.json
export interface VestingNodeConstrained extends VestingNode {
  type: VNodeEnum.CONSTRAINED;
  constraints: (
    | TemporalConstraintBefore
    | TemporalConstraintAfter
    | TemporalConstraintOrGroup
  )[];
}

export type Anchor =
  | VestingBaseDate
  | VestingBaseEvent
  | VestingNodeConstrained;

// ==== From ====
export type From = Anchor | FromOperator;

export interface FromEarlierOf extends EarlierOf<From> {}

export interface FromLaterOf extends LaterOf<From> {}

export type FromOperator = FromEarlierOf | FromLaterOf;

// ==== CLIFF ====

export type Cliff =
  | Duration // time-based cliff (e.g., ClIFF 12 months)
  | Anchor
  | CliffOperator;

export interface CliffEarlierOf extends EarlierOf<Cliff> {}

export interface CliffLaterOf extends LaterOf<Cliff> {}

export type CliffOperator = CliffEarlierOf | CliffLaterOf;
