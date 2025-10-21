import { OCTDate, Statement as NormalizedStatement } from "@vestlang/types";

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
