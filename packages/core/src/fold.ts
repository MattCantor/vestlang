// The generic anchor-date fold — the shared primitive behind both the cliff and
// the grant-date aggregation (the two are the same fold over a different anchor
// date).
//
// Ported from vestlang's evaluate/cliff.ts `evaluateCliffGeneric` /
// `evaluateGrantDate`, stripped to the pure date/amount mechanics. The
// blocker/installment-producing callers stay in the evaluator; core only needs
// the aggregation: amounts dated before `cliffDate` collapse onto `cliffDate`.

import type { OCTDate } from "@vestlang/types";
import { eq, lt } from "./dates";

/**
 * Fold a parallel (dates, amounts) series against an anchor `cliffDate`:
 *   - amounts strictly before cliffDate aggregate; the aggregate is emitted on
 *     cliffDate either when the run ends before it, or — if non-zero — when the
 *     next date is past it,
 *   - the amount exactly on cliffDate absorbs the running aggregate,
 *   - amounts after cliffDate pass through unchanged.
 * Each emission spends the aggregate, so it resets to zero — a second date on
 * the cliff (e.g. installments from two statements) emits only its own amount.
 * `fn` maps each emitted {date, amount} to the caller's installment shape.
 */
export function foldByCliffDate<T>(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
  fn: (x: { date: OCTDate; amount: number }) => T,
): T[] {
  const out: T[] = [];
  let aggregate = 0;
  let cliffResolved = false;

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const amt = amounts[i];

    const isBefore = lt(date, cliffDate);
    const isAt = eq(date, cliffDate);

    // Dates before the cliff only aggregate.
    if (isBefore) {
      aggregate += amt;
      // If this is the last date and we're still before the cliff, emit the
      // aggregate on the cliff date.
      if (i === dates.length - 1) {
        out.push(fn({ date: cliffDate, amount: aggregate }));
        aggregate = 0;
      }
      continue;
    }

    // Date exactly on the cliff absorbs the aggregate.
    if (isAt) {
      aggregate += amt;
      out.push(fn({ date, amount: aggregate }));
      aggregate = 0;
      cliffResolved = true;
      continue;
    }

    // Cliff date falls strictly between the previous date and this one: flush
    // the (non-zero) aggregate onto the cliff date before this installment.
    if (!cliffResolved && lt(cliffDate, date) && aggregate > 0) {
      out.push(fn({ date: cliffDate, amount: aggregate }));
      aggregate = 0;
      cliffResolved = true;
    }
    out.push(fn({ date, amount: amt }));
  }

  return out;
}

/**
 * The grant-date specialization: aggregate pre-grant amounts onto the grant date
 * and return the rewritten parallel series. (Relocated `evaluateGrantDate`.)
 */
export function foldToGrantDate(
  dates: OCTDate[],
  amounts: number[],
  grantDate: OCTDate,
): { dates: OCTDate[]; amounts: number[] } {
  const folded = foldByCliffDate<{ date: OCTDate; amount: number }>(
    dates,
    amounts,
    grantDate,
    ({ date, amount }) => ({ date, amount }),
  );

  return {
    dates: folded.map((v) => v.date),
    amounts: folded.map((v) => v.amount),
  };
}
