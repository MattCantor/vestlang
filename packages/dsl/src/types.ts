// ==== Helpers ====
type TwoOrMore<T> = [T, T, ...T[]];

export interface ASTStatement {
  amount: AstAmount; // { type: "AmountInteger" } | { type: "AmountPercent" }
  expr: ASTExpr; // Schedule | EarlierOfSchedules | LaterOfSchedules
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

export type ASTExpr = ASTSchedule | EarlierOfASTSchedules | LaterOfASTSchedules;

export interface EarlierOfASTSchedules {
  type: "EarlierOfSchedules";
  items: TwoOrMore<ASTExpr>;
}

export interface LaterOfASTSchedules {
  type: "LaterOfSchedules";
  items: TwoOrMore<ASTExpr>;
}

export interface ASTSchedule {
  type: "Schedule";
  from?: FromTerm;
  over: Duration;
  every: Duration;
  cliff?: CliffTerm;
}

// ==== Durations (normalized by grammar) ====

export interface Duration {
  type: "Duration";
  value: number;
  unit: Unit; // grammar converts weeks->days, years->months
}

export type Unit = "DAYS" | "MONTHS";

// ==== Anchors (atoms) ====

export type Anchor = DateAnchor | EventAnchor;

export interface DateAnchor {
  type: "Date";
  value: string; // YYYY-MM-DD
}

export interface EventAnchor {
  type: "Event";
  value: string; // Ident
}

// ==== Predicates ====

export type TemporalPredNode =
  | { type: "After"; i: Anchor; strict: boolean }
  | { type: "Before"; i: Anchor; strict: boolean }
  | { type: "Between"; a: Anchor; b: Anchor; strict: boolean };

export interface QualifiedAnchor {
  type: "Qualified";
  base: Anchor;
  predicates: TemporalPredNode[];
}

// ==== FROM (recursive) ====

export type FromTerm =
  | Anchor // bare Date / Event
  | QualifiedAnchor // Date/Event with BY/BEFORE/AFTER/BETWEEN
  | EarlierOfFrom
  | LaterOfFrom;

export interface EarlierOfFrom {
  type: "EarlierOf";
  items: TwoOrMore<FromTerm>;
}

export interface LaterOfFrom {
  type: "LaterOf";
  items: TwoOrMore<FromTerm>;
}

// ==== CLIFF (recursive) ====

export type CliffTerm =
  | Duration // time-based cliff (e.g., ClIFF 12 months)
  | Anchor // date/event cliff
  | QualifiedAnchor // date/event with qualifier
  | EarlierOfCliff
  | LaterOfCliff;

export interface EarlierOfCliff {
  type: "EarlierOf";
  items: TwoOrMore<CliffTerm>;
}

export interface LaterOfCliff {
  type: "LaterOf";
  items: TwoOrMore<CliffTerm>;
}

// A base that can be evaluated: either a bare anchor OR a combinator node from FromTerm
export type FromBase = Anchor | EarlierOfFrom | LaterOfFrom;
