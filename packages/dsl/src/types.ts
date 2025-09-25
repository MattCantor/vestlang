export type Unit = "days" | "weeks" | "months" | "years";

export interface Duration {
  kind: "Duration";
  value: number;
  unit: Unit;
}

export interface DateAtom {
  kind: "Date";
  iso: string; // YYYY-MM-DD
}

export interface EventAtom {
  kind: "Event";
  name: string;
}

export type Anchor = DateAtom | EventAtom;

export interface Amount {
  kind: "Amount";
  value: number; // percent by default
}

export type TimeGate = Duration | DateAtom | { kind: "Zero" };

export type Condition =
  | EventAtom
  | { kind: "At"; date: DateAtom }
  | { kind: "After"; duration: Duration }
  | { kind: "EarlierOf"; items: Condition[] }
  | { kind: "LaterOf"; items: Condition[] };

export interface Schedule {
  from?: Anchor; // default grantDate
  over: Duration; // 0 allowed
  every: Duration; // 0 iff over=0
  cliff?: TimeGate; // default 0
}

export interface Statement {
  amount: Amount;
  schedule?: Schedule; // if absent, one-shot is implied
  if?: Condition; // eligibility gate
  // parser metadata optional
  _meta?: Record<string, unknown>;
}
