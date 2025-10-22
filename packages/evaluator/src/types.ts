import {
  OCTDate,
  Statement as NormalizedStatement,
  PeriodTag,
} from "@vestlang/types";

export interface EvaluationContext {
  events: Record<string, OCTDate | undefined>;
  grantQuantity: number;
  asOf: OCTDate;
}

export type NodeResolutionState =
  | { state: "inactive" }
  | { state: "unresolved" }
  | { state: "resolved"; date: OCTDate };

export interface Tranche {
  date: OCTDate;
  amount: number;
}

/** Symbolic date for display/debug */
export type SymbolicDate =
  | { type: "START" }
  | { type: "CLIFF" }
  | { type: "START_PLUS"; unit: PeriodTag; steps: number };

/** Why a tranche cannot be resolved yet */
export type Blocker =
  | { type: "MISSING_EVENT"; event: string }
  | { type: "UNRESOLVED_SELECTOR"; selector: "EARLIER_OF" | "LATER_OF" }
  | { type: "UNRESOLVED_START" }
  | { type: "UNRESOLVED_CLIFF" }
  | { type: "CONSTRAINT_FALSE_BUT_SATISFIABLE"; note: string }
  | { type: "CONSTRAINT_FALSE_NOT_SATISFIABLE"; note: string };

export interface TrancheStatus {
  index: number;
  status: NodeResolutionState;
  symbolicDate?: SymbolicDate;
  amount: number;
  blockers: Blocker[];
}

export interface Schedule {
  vesting_start: NodeResolutionState;
  cliff?: { input: NodeResolutionState; applied: boolean };
  tranches: Tranche[]; // empty if unresolved/inactive
}

export interface Statement {
  source: NormalizedStatement;
  schedule: Schedule;
}

export interface Program {
  statements: Statement[];
}
