// Builds the EvaluationContext the engine consumes from a grant's loose scalars.
// Kept internal to the pipeline: the run* entry points call it with their own
// inputs, so an app can't construct a context by hand and forget a piece (the
// named-events drop that bit the CLI's as-of command came from exactly that).

import { todayISO } from "@vestlang/utils";
import type {
  EvaluationContextInput,
  OCTDate,
  VestingDayOfMonth,
} from "@vestlang/types";

export type BuildContextInput = {
  grant_date: OCTDate;
  grant_quantity: number;
  events?: Record<string, OCTDate>;
  as_of?: OCTDate;
  vesting_day_of_month?: VestingDayOfMonth;
};

export function buildContext(input: BuildContextInput): EvaluationContextInput {
  // grantDate is its own context field (a runtime anchor, not a fired event); the
  // events map carries only genuine named events, passed through untouched.
  return {
    grantDate: input.grant_date,
    events: { ...(input.events ?? {}) },
    grantQuantity: input.grant_quantity,
    asOf: input.as_of ?? todayISO(),
    // Left undefined on purpose: the evaluator defaults the day-of-month rule
    // itself, so we don't repeat the literal here.
    vesting_day_of_month: input.vesting_day_of_month,
  };
}
