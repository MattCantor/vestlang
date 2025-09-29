// ==== Core statement ====

export interface Statement {
  amount: Amount; // { type: "AmountInteger" } | { type: "AmountPercent" }
  expr: Expr; // Schedule | EarlierOfSchedules | LaterOfSchedules
}

// ==== Amounts ====

export type Amount = AmountInteger | AmountPercent;

export interface AmountInteger {
  type: "AmountInteger";
  value: number; // whole shares
}

export interface AmountPercent {
  type: "AmountPercent";
  value: number; // faction in [0, 1]
}

// ==== Expressions ====

export type Expr = Schedule | EarlierOfSchedules | LaterOfSchedules;

export interface EarlierOfSchedules {
  type: "EarlierOfSchedules";
  items: Expr[];
}

export interface LaterOfSchedules {
  type: "LaterOfSchedules";
  items: Expr[];
}

export interface Schedule {
  type: "Schedule";
  from?: FromTerm | null; // TODO: make this default to the grant date in the normalizer
  over: Duration | ZeroGate;
  every: Duration | ZeroGate;
  cliff?: CliffTerm; // default: { type: "Zero" }
}

// ==== Durations (normalized by grammar) ====

export interface Duration {
  type: "Duration";
  value: number;
  unit: Unit; // grammar converts weeks->days, years->months
}

export type Unit = "days" | "months";

// ==== Anchors (atoms) ====

export type Anchor = DateGate | EventAtom;

export interface DateGate {
  type: "Date";
  iso: string; // YYYY-MM-DD
}

export interface EventAtom {
  type: "Event";
  name: string; // Ident
}

// ==== Temporal qualifiers & qualified atoms ====
// mkQualified(base, qualifier) returns either the base OR a Qualified wrapper
// so downstream should accept both Anchor and Qualified<Anchor>.

export type TemporalQualifier =
  | ByQualifier
  | BeforeQualifier
  | AfterQualifier
  | BetweenQualifier;

export interface ByQualifier {
  type: "By";
  target: Anchor; // on or before target
}
export interface BeforeQualifier {
  type: "Before";
  target: Anchor; // strictly before target
}

export interface AfterQualifier {
  type: "After";
  target: Anchor; // strictly after target
}

export interface BetweenQualifier {
  type: "Between";
  start: Anchor;
  end: Anchor;
}

export interface QualifiedAnchor {
  type: "Qualified";
  base: Anchor; // Date or Event
  qualifier: TemporalQualifier;
}

// ==== FROM (recursive) ====

export type FromTerm =
  | Anchor // bare Date / Event
  | QualifiedAnchor // Date/Event with BY/BEFORE/AFTER/BETWEEN
  | EarlierOfFrom
  | LaterOfFrom;

export interface EarlierOfFrom {
  type: "EarlierOf";
  items: FromTerm[];
}

export interface LaterOfFrom {
  type: "LaterOf";
  items: FromTerm[];
}

// ==== CLIFF (recursive) ====

export type CliffTerm =
  | ZeroGate
  | Duration // time-based cliff (e.g., ClIFF 12 months)
  | Anchor // date/event cliff
  | QualifiedAnchor // date/event with qualifier
  | EarlierOfCliff
  | LaterOfCliff;

export interface ZeroGate {
  type: "Zero";
}

export interface EarlierOfCliff {
  type: "EarlierOf";
  items: CliffTerm[];
}

export interface LaterOfCliff {
  type: "LaterOf";
  items: CliffTerm[];
}
