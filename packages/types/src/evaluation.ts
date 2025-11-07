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

/* ------------------------
 * Evaluated Schedule
 * ------------------------ */

export interface EvaluatedSchedule<T extends Installment = Installment> {
  installments: T[];
  blockers: Blocker[];
}
