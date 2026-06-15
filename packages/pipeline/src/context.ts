// Builds the engine context from a grant's loose scalars. Kept internal to the
// pipeline: the run* entry points call these with their own inputs, so an app
// can't construct a context by hand and forget a piece (the named-events drop
// that bit the CLI's as-of command came from exactly that).
//
// Two builders, mirroring the two context flavors: a structure-resolution
// context carries no observation time, and the point-in-time builder is the one
// place on the query path that reaches for `todayISO()` when no `as_of` is given.

import { todayISO } from "@vestlang/utils";
import type {
  ResolutionContextInput,
  AsOfContextInput,
  OCTDate,
  VestingDayOfMonth,
} from "@vestlang/types";

export type BuildContextInput = {
  grant_date: OCTDate;
  grant_quantity: number;
  events?: Record<string, OCTDate>;
  vesting_day_of_month?: VestingDayOfMonth;
};

export type BuildAsOfContextInput = BuildContextInput & {
  as_of?: OCTDate;
};

export function buildContext(input: BuildContextInput): ResolutionContextInput {
  // grantDate is its own context field (a runtime anchor, not a fired event); the
  // events map carries only genuine named events, passed through untouched.
  return {
    grantDate: input.grant_date,
    events: { ...(input.events ?? {}) },
    grantQuantity: input.grant_quantity,
    // Left undefined on purpose: the evaluator defaults the day-of-month rule
    // itself, so we don't repeat the literal here.
    vesting_day_of_month: input.vesting_day_of_month,
  };
}

export function buildAsOfContext(
  input: BuildAsOfContextInput,
): AsOfContextInput {
  return {
    ...buildContext(input),
    // Omitting the observation date means "as of today" — the only place that
    // default is read on the query path.
    asOf: input.as_of ?? todayISO(),
  };
}
