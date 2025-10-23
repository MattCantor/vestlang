import {
  OCTDate,
  Statement as NormalizedStatement,
  PeriodTag,
  vesting_day_of_month,
  Schedule as NormalizedSchedule,
} from "@vestlang/types";

export interface EvaluationContext {
  events: Record<string, OCTDate | undefined>;
  grantQuantity: number;
  asOf: OCTDate;
  vesting_day_of_month: vesting_day_of_month;
}

export type EvaluationContextInput = Omit<
  EvaluationContext,
  "vesting_day_of_month"
> &
  Partial<Pick<EvaluationContext, "vesting_day_of_month">>;

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

export type PickedSchedule = {
  chosen?: NormalizedSchedule;
  vesting_start?: OCTDate;
  unresolved: boolean;
};

export interface ExpandedSchedule {
  vesting_start: NodeResolutionState;
  cliff?: { input: NodeResolutionState; applied: boolean };
  tranches: Tranche[]; // empty if unresolved/inactive
}

export interface Statement {
  source: NormalizedStatement;
  schedule: ExpandedSchedule;
}

export interface Program {
  statements: Statement[];
}
