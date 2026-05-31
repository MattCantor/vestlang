import type { VestingRuntime, VestingScheduleTemplate } from "@vestlang/core";
import { VestingNode } from "./ast.js";
import { PeriodTag } from "./enums.js";
import { OCTDate } from "./helpers.js";
import { allocation_type, vesting_day_of_month } from "./oct_types.js";

export interface EvaluationContext {
  events: { grantDate: OCTDate } & Record<string, OCTDate | undefined>;
  grantQuantity: number;
  asOf: OCTDate;
  vesting_day_of_month: vesting_day_of_month;
  allocation_type: allocation_type;
}

export type EvaluationContextInput = Omit<
  EvaluationContext,
  "vesting_day_of_month"
> &
  Partial<Pick<EvaluationContext, "vesting_day_of_month" | "allocation_type">>;

export type SymbolicDate =
  | { type: "START_PLUS"; unit: PeriodTag; steps: number }
  | { type: "UNRESOLVED_VESTING_START" }
  | { type: "UNRESOLVED_CLIFF"; date: OCTDate };

/* ------------------------
 * Blockers
 * ------------------------ */

export type UnresolvedBlocker =
  | {
      type: "EVENT_NOT_YET_OCCURRED";
      event: string;
    }
  | {
      type: "UNRESOLVED_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: Blocker[];
    }
  | {
      type: "DATE_NOT_YET_OCCURRED";
      date: OCTDate;
    }
  | {
      type: "UNRESOLVED_CONDITION";
      condition: Omit<VestingNode, "type">;
    };

export type ImpossibleBlocker =
  | {
      type: "IMPOSSIBLE_SELECTOR";
      selector: "EARLIER_OF" | "LATER_OF";
      blockers: ImpossibleBlocker[];
    }
  | {
      type: "IMPOSSIBLE_CONDITION";
      condition: Omit<VestingNode, "type">;
    };

export type Blocker = UnresolvedBlocker | ImpossibleBlocker;

/* ------------------------
 * Node Meta
 * ------------------------ */

export type NodeResolutionState = "IMPOSSIBLE" | "UNRESOLVED" | "RESOLVED";

export type ResolvedNode = {
  type: "RESOLVED";
  date: OCTDate;
};

export type UnresolvedNode = {
  type: "UNRESOLVED";
  blockers: (UnresolvedBlocker | ImpossibleBlocker)[];
};

export type ImpossibleNode = {
  type: "IMPOSSIBLE";
  blockers: ImpossibleBlocker[];
};

export type NodeMeta = ResolvedNode | UnresolvedNode | ImpossibleNode;

/* ------------------------
 * Installments
 * ------------------------ */

export interface InstallmentMeta {
  index?: number;
  state: NodeResolutionState;
  symbolicDate?: SymbolicDate;
  unresolved?: string;
}

export interface BaseInstallment {
  amount: number;
  date?: OCTDate;
  meta: InstallmentMeta;
}

export interface ImpossibleInstallment extends BaseInstallment {
  amount: number;
  date?: never;
  meta: {
    state: "IMPOSSIBLE";
    symbolicDate?: never;
    unresolved: string;
  };
}

export interface UnresolvedInstallment extends BaseInstallment {
  date?: never;
  meta: {
    state: "UNRESOLVED";
    symbolicDate: SymbolicDate;
    unresolved: string;
  };
}

export interface ResolvedInstallment extends BaseInstallment {
  date: OCTDate;
  meta: {
    state: "RESOLVED";
    symbolicDate?: never;
    unresolved?: never;
  };
}

export type Installment =
  | ImpossibleInstallment
  | UnresolvedInstallment
  | ResolvedInstallment;

/** Amount-carrying installments with symbolic/absent dates (the unresolved arm). */
export type SymbolicInstallment = UnresolvedInstallment | ImpossibleInstallment;

/* ------------------------
 * Source map
 * ------------------------ */

/**
 * One externalized gate definition: the DSL the synthetic `event_id` stands in
 * for, plus an optional display name. `definition` is `@vestlang/stringify`
 * output — re-resolvable AND legible. Populated by Case 2 (Phase 3); `{}` until
 * then.
 */
export interface SourceMapEntry {
  definition: string;
  label?: string;
}

/** `event_id → { definition, label? }`, keyed once per synthetic event. */
export type SourceMap = Record<string, SourceMapEntry>;

/* ------------------------
 * Evaluated Schedule
 * ------------------------ */

/**
 * The verdict discriminant — spans both *resolvability* and *fidelity*:
 *   - "template"    — resolvable AND fits canonical's one-template shape (spec held).
 *   - "events-only" — resolvable to dated amounts but doesn't fit one template
 *                     (carries `reason`); facts preserved, intent lost.
 *   - "unresolved"  — pending: can't be materialized yet (e.g. unfired event).
 *   - "impossible"  — terminal/unsatisfiable: no witness assignment can resolve it.
 */
export type Status = "template" | "events-only" | "unresolved" | "impossible";

/**
 * The published evaluation contract. A discriminated union keyed on `status`,
 * where the presence of the canonical artifact is implied by the arm.
 *
 * The first arm is untagged: the public evaluate path always tags a verdict, but
 * internal installment-builder helpers (makeTranches/unresolved) produce bare
 * `{ installments, blockers }` containers. `status` becomes required once those
 * helpers carry their own container type (a clean follow-up).
 */
export type EvaluatedSchedule =
  | {
      status?: undefined;
      installments: Installment[];
      blockers: Blocker[];
      reason?: string;
    }
  | {
      status: "template";
      template: VestingScheduleTemplate;
      runtime: VestingRuntime;
      sourceMap: SourceMap;
      installments: ResolvedInstallment[];
      blockers: Blocker[];
    }
  | {
      status: "events-only";
      installments: ResolvedInstallment[];
      reason: string;
      blockers: Blocker[];
    }
  | {
      status: "unresolved";
      installments: SymbolicInstallment[];
      blockers: Blocker[];
    }
  | {
      status: "impossible";
      installments: ImpossibleInstallment[];
      blockers: ImpossibleBlocker[];
    };
