// New top-level statement algebra
export type TopStmt = Program | EarlierOfPrograms | LaterOfPrograms;

export interface EarlierOfPrograms {
  kind: "EarlierOfPrograms";
  items: TopStmt[]; // flattened by normalizer
}

export interface LaterOfPrograms {
  kind: "LaterOfPrograms";
  items: TopStmt[]; // flattened by normalizer
}

// Existing Program (unchanged conceptually)
export interface Program {
  kind: "Program";
  schedule?: Schedule; // will be injected by CNF if absent
  if?: Condition;
}

export interface Schedule {
  from?: Anchor; // default grantDate
  over: Duration; // 0 allowed
  every: Duration; // 0 iff over=0
  cliff?: TimeGate; // default 0
}

export type TimeGate = ZeroGate | DateGate | Duration; // your current union
export interface ZeroGate {
  kind: "Zero";
}
export interface DateGate {
  kind: "Date";
  iso: string;
}

export type Anchor = DateGate | EventAtom;

export interface Amount {
  kind: "Amount";
  value: number; // first token in the DSL line
}

export type Condition = EventAtom | AtDate | After | EarlierOf | LaterOf;

export interface EventAtom {
  kind: "Event";
  name: string;
}

export interface AtDate {
  kind: "At";
  date: DateGate;
}
export interface After {
  kind: "After";
  duration: Duration;
  from?: never;
} // duration relative to SCHEDULE.from
export interface EarlierOf {
  kind: "EarlierOf";
  items: Condition[];
}
export interface LaterOf {
  kind: "LaterOf";
  items: Condition[];
}

export interface Duration {
  kind: "Duration";
  value: number;
  unit: Unit;
}

export type Unit = "days" | "months";

// The full statement line produced by parser
export interface Statement {
  kind: "Statement";
  amount: Amount;
  top: TopStmt;
}
