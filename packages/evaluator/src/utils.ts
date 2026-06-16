import {
  DEFAULT_VESTING_DAY_OF_MONTH,
  OCTDate,
  ResolutionContext,
  ResolutionContextInput,
  AsOfContext,
  AsOfContextInput,
} from "@vestlang/types";
import { isValidCalendarDate } from "@vestlang/utils";

// One builder over both context flavors: hand it a structure (no-`asOf`) input
// and you get a `ResolutionContext` back; hand it an as-of input and the `asOf`
// rides through to an `AsOfContext`. Either way it does the two jobs every entry
// relies on — police the share count and default the day-of-month rule.
export function createEvaluationContext(input: AsOfContextInput): AsOfContext;
export function createEvaluationContext(
  input: ResolutionContextInput,
): ResolutionContext;
export function createEvaluationContext(
  input: ResolutionContextInput,
): ResolutionContext {
  // Every evaluator entry funnels through here, so this is where the grant's
  // share count gets policed — the same safe-integer rule core's compile
  // applies to totalShares. Without it a bad grantQuantity travels all the way
  // to the allocation kernel and dies there with a kernel-flavored error.
  if (!Number.isSafeInteger(input.grantQuantity) || input.grantQuantity < 0) {
    throw new Error(
      `grantQuantity must be a non-negative safe integer (got ${input.grantQuantity})`,
    );
  }

  // Same funnel, same fail-loud stance for the context's *dates*. A bad date
  // string like "2025-02-31" looks plausible but isn't real, and the date
  // arithmetic downstream silently rolls it forward (to "2025-03-03") instead
  // of complaining — so a typo becomes a wrong projection with no diagnostic.
  // Catch it here with the same calendar check every other input boundary
  // (grammar, MCP, CLI) uses, so "is this a real date?" gets one answer.
  // The `typeof` belt-and-suspenders matters because a programmatic JS caller
  // can hand us a non-string and slip past the OCTDate type. Every bad field
  // is collected first and reported together — `events` can hold several — so
  // a caller fixes them in one pass instead of one error at a time.
  const dateErrors: string[] = [];
  const checkDate = (label: string, value: unknown): void => {
    if (typeof value !== "string" || !isValidCalendarDate(value)) {
      dateErrors.push(
        `${label}: must be a real calendar date (YYYY-MM-DD) (got "${String(value)}")`,
      );
    }
  };

  checkDate("grantDate", input.grantDate);
  // An `undefined` event is "named but not yet fired" — a meaningful absence,
  // not a bad date — so only the fired ones get checked.
  for (const [key, value] of Object.entries(input.events)) {
    if (value !== undefined) {
      checkDate(`events.${key}`, value);
    }
  }
  // `asOf` only exists on the as-of overload, which funnels through here too.
  // The runtime signature is the no-`asOf` shape, so read it structurally and
  // check it only when a real caller actually supplied one.
  const asOf = (input as Partial<AsOfContextInput>).asOf;
  if (asOf !== undefined) {
    checkDate("asOf", asOf);
  }

  if (dateErrors.length > 0) {
    throw new Error(
      `Invalid evaluation context:\n${dateErrors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  // Rebuild `events` on a null prototype. An event id can legally be a
  // `Object.prototype` key (`constructor`, `toString`, `__proto__`, …); on a
  // plain object an unfired such id reads back the inherited value, so the EVENT
  // atom would treat it as fired with a function for a "date" and throw. Copying
  // own entries onto a prototype-less object makes a missing key read `undefined`.
  const events = Object.assign(
    Object.create(null) as Record<string, OCTDate | undefined>,
    input.events,
  );

  return {
    ...input,
    events,
    vesting_day_of_month:
      input.vesting_day_of_month ?? DEFAULT_VESTING_DAY_OF_MONTH,
  };
}
