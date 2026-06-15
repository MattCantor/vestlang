import {
  DEFAULT_VESTING_DAY_OF_MONTH,
  ResolutionContext,
  ResolutionContextInput,
  AsOfContext,
  AsOfContextInput,
} from "@vestlang/types";

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
  return {
    ...input,
    vesting_day_of_month:
      input.vesting_day_of_month ?? DEFAULT_VESTING_DAY_OF_MONTH,
  };
}
