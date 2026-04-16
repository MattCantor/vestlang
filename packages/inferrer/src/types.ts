import type { PeriodTag, Program } from "@vestlang/types";
import type { OCTDate } from "@vestlang/types";
import type {
  allocation_type,
  vesting_day_of_month,
} from "@vestlang/types";

export interface TrancheInput {
  date: OCTDate;
  amount: number;
}

export interface InferInput {
  tranches: TrancheInput[];
  grantDate?: OCTDate;
}

export interface UniformComponent {
  kind: "UNIFORM";
  startDate: OCTDate;
  cadence: { unit: PeriodTag; length: number };
  occurrences: number;
  perTrancheAmount: number;
}

export interface SingleTrancheComponent {
  kind: "SINGLE_TRANCHE";
  date: OCTDate;
  amount: number;
}

export interface CliffUniformComponent {
  kind: "CLIFF_UNIFORM";
  grantDate: OCTDate;
  cadence: { unit: PeriodTag; length: number };
  cliffSteps: number;
  tailOccurrences: number;
  perTrancheAmount: number;
}

export type Component =
  | UniformComponent
  | SingleTrancheComponent
  | CliffUniformComponent;

export interface InferResult {
  dsl: string;
  program: Program;
  decomposition: {
    uniforms: Array<Omit<UniformComponent, "kind">>;
    singles: Array<Omit<SingleTrancheComponent, "kind">>;
    cliffFolds: number;
  };
  diagnostics: {
    residualError: number;
    totalQuantity: number;
    vestingDayOfMonth: vesting_day_of_month;
    allocationType: allocation_type;
    cadenceTried: string[];
    notes: string[];
  };
}
