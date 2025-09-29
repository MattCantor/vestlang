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

// ==== Canonical window used everywhere downstream ====
export interface TimeWindow {
  start?: Anchor; // undefined = negative infinite
  end?: Anchor; // undefined = positive infinity
  includeStart: boolean; // defaults to true
  includeEnd: boolean; // defaults to true
}

// A base that can be evaluated: either a bare anchor OR a combinator node from FromTerm
export type FromBase = Anchor | EarlierOfFrom | LaterOfFrom;

// Schedule after normalization: same data + resolved window for FROM
export interface NormalizedSchedule {
  type: "Schedule";
  fromBase: FromBase | null; // The structural FROM (no predicates)
  fromWindow: TimeWindow; // the lowered window (include* flags explicit)
  over: Duration | ZeroGate;
  every: Duration | ZeroGate;
  cliff?: CliffTerm;
}

// Expr after normalization: recurse and normalize every Schedule
export type NormalizedExpr =
  | NormalizedSchedule
  | { type: "EarlierOfSchedules"; items: NormalizedExpr[] }
  | { type: "LaterOfSchedules"; items: NormalizedExpr[] };
