// ==== Helpers ====
export type TwoOrMore<T> = [T, T, ...T[]];

export type SelectorTag = "EarlierOf" | "LaterOf";

export interface Selector<T, K extends SelectorTag = SelectorTag> {
  type: K;
  items: TwoOrMore<T>;
}

export interface EarlierOf<T> extends Selector<T, "EarlierOf"> {}

export interface LaterOf<T> extends Selector<T, "LaterOf"> {}

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

// ==== Expressions ====

export type ASTExpr = ASTSchedule | ASTExprSelector;

export interface EarlierOfASTExpr extends EarlierOf<ASTExpr> {}

export interface LaterOfASTExpr extends LaterOf<ASTExpr> {}

export type ASTExprSelector = EarlierOfASTExpr | LaterOfASTExpr;

export interface ASTSchedule {
  type: "Schedule";
  from?: From | null;
  over: Duration;
  every: Duration;
  cliff?: Cliff;
}

// ==== Durations (normalized by grammar) ====

export interface Duration {
  type: "Duration";
  value: number;
  unit: Unit; // grammar converts weeks->days, years->months
}

export type Unit = "DAYS" | "MONTHS";

// ==== Anchors (atoms) ====

export type BareAnchor = DateAnchor | EventAnchor;

export interface DateAnchor {
  type: "Date";
  value: string; // YYYY-MM-DD
}

export interface EventAnchor {
  type: "Event";
  value: string; // Ident
}

// ==== Constraints ====

export type BaseConstraint =
  | { type: "After"; anchor: BareAnchor; strict: boolean }
  | { type: "Before"; anchor: BareAnchor; strict: boolean };

export interface AnyConstraint {
  anyOf: TwoOrMore<BaseConstraint>;
}

export type Constraint = BaseConstraint | AnyConstraint;

export interface ConstrainedAnchor {
  type: "Constrained";
  base: BareAnchor;
  constraints: Constraint[];
}

export type Anchor = BareAnchor | ConstrainedAnchor;

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
