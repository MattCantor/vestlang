import { Condition, VestingNode } from "./ast.js";
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
  | { type: "BEFORE_GRANT_DATE" }
  | { type: "BEFORE_VESTING_START" }
  | { type: "MAYBE_BEFORE_CLIFF" };

/* ------------------------
 * False Constraints
 * ------------------------ */

// export interface ImpossibleConstraint {
//   type: "IMPOSSIBLE";
//   constraint: Constraint;
// }
//
// export interface UnresolvedConstraint {
//   type: "UNRESOLVED";
//   constraint: Constraint;
// }
//
// export type UnsatisfiedConstraint = ImpossibleConstraint | UnresolvedConstraint;
//
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
 * Tranche
 * ------------------------ */

export interface TrancheMeta {
  index?: number;
  state: NodeResolutionState;
  date?: SymbolicDate;
  // blockers?: Blocker[];
  blockers?: string;
}

export interface BaseTranche {
  amount: number;
  date?: OCTDate;
  meta: TrancheMeta;
}

export interface ImpossibleTranche extends BaseTranche {
  amount: 0;
  date?: never;
  meta: {
    state: "IMPOSSIBLE";
    date?: never;
    // blockers: Blocker[];
    blockers: string;
  };
}

export interface UnresolvedTranche extends BaseTranche {
  date?: never;
  meta: {
    state: "UNRESOLVED";
    date: SymbolicDate;
    // blockers: Blocker[];
    blockers: string;
  };
}

export interface ResolvedTranche extends BaseTranche {
  date: OCTDate;
  meta: {
    state: "RESOLVED";
    date?: never;
    blockers?: never;
  };
}

export type Tranche = ImpossibleTranche | UnresolvedTranche | ResolvedTranche;
