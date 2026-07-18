// The anchor-date fold: amounts dated before `cliffDate` collapse onto
// `cliffDate`, amounts on or after pass through. Used directly by
// `foldToGrantDate`; in-repo the fold is reached via that wrapper (the kernel's
// grant-date fold and the evaluator's unresolved-arm folds).

import type {
  Installment,
  OCTDate,
  ResolvedInstallment,
  ScheduledFold,
} from "@vestlang/types";
import { eq, gt, lt } from "./dates.js";

// The boundary both the fold and the provenance allocator key on: a date before
// the anchor relocates onto it, a date at or after it stays put. The fold
// aggregates the relocated amounts; `allocateWithProvenance` relocates each
// provenance row's date by this same rule, so the two never drift on which side
// of the anchor a date falls.
export const relocateToCliffDate = (
  date: OCTDate,
  cliffDate: OCTDate,
): OCTDate => (lt(date, cliffDate) ? cliffDate : date);

/**
 * Fold a parallel (dates, amounts) series against an anchor `cliffDate`:
 *   - amounts strictly before cliffDate aggregate; the aggregate is emitted on
 *     cliffDate either when the run ends before it, or — if non-zero — when the
 *     next date is past it,
 *   - the amount exactly on cliffDate absorbs the running aggregate,
 *   - amounts after cliffDate pass through unchanged.
 * Each emission spends the aggregate, so it resets to zero — a second date on
 * the cliff (e.g. installments from two statements) emits only its own amount.
 */
export function foldByCliffDate(
  dates: OCTDate[],
  amounts: number[],
  cliffDate: OCTDate,
): { date: OCTDate; amount: number }[] {
  const out: { date: OCTDate; amount: number }[] = [];
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
        out.push({ date: cliffDate, amount: aggregate });
        aggregate = 0;
      }
      continue;
    }

    // Date exactly on the cliff absorbs the aggregate.
    if (isAt) {
      aggregate += amt;
      out.push({ date, amount: aggregate });
      aggregate = 0;
      cliffResolved = true;
      continue;
    }

    // Cliff date falls strictly between the previous date and this one: flush
    // the (non-zero) aggregate onto the cliff date before this installment.
    if (!cliffResolved && lt(cliffDate, date) && aggregate > 0) {
      out.push({ date: cliffDate, amount: aggregate });
      aggregate = 0;
      cliffResolved = true;
    }
    out.push({ date, amount: amt });
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
  const folded = foldByCliffDate(dates, amounts, grantDate);

  return {
    dates: folded.map((v) => v.date),
    amounts: folded.map((v) => v.amount),
  };
}

// A row in the display-coalescing pass: a date and the integer it carries, plus
// the provenance keys the merged order sorts on. The keys are optional so the
// rollup can hand in already-coalesced installments (which no longer carry them)
// and fall back to a stable date sort. `scheduled` is the pre-fold partition the
// row carries INTO the merge (#441) — a per-statement folded line forwards its
// whole list, a singleton elsewhere; absent on a row with nothing to preserve.
export interface CoalesceRow {
  date: OCTDate;
  amount: number;
  statementOrder?: number;
  occurrence?: number;
  scheduled?: ScheduledFold[];
}

// The one allocation/merge order: by date, then statement order, then occurrence
// (so a cliff lump, occurrence 0, leads its day). The single source for both the
// kernel's allocate sort and the display coalesce, so they can't drift. The keys
// default to 0 for callers (the rollup) that no longer carry them; a `RawEvent`
// always carries both, so the defaults never bite there.
export const byDateOrderOccurrence = (
  a: { date: OCTDate; statementOrder?: number; occurrence?: number },
  b: { date: OCTDate; statementOrder?: number; occurrence?: number },
): number => {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const order = (a.statementOrder ?? 0) - (b.statementOrder ?? 0);
  if (order !== 0) return order;
  return (a.occurrence ?? 0) - (b.occurrence ?? 0);
};

/**
 * Collapse a clause's already-relocated rows into the per-clause DISPLAY shape:
 * the rows landing on `grantDate` sum into one leading grant-date tranche, every
 * other row passes through on its own date. This is NOT `foldToGrantDate` — the
 * carrier rows are already AT `grantDate` (relocated row-by-row for #441
 * headroom), and `foldToGrantDate` only aggregates rows strictly before the
 * anchor, so over relocated rows it would be an identity and leave several
 * grant-date tranches. Here the merge is explicit.
 *
 * Rows sort by `(date, statementOrder, occurrence)` — the same tiebreak the
 * allocator uses — so a THEN chain's segments merge in the order they'd allocate.
 * A missing `grantDate` (no grant-date fold in play) just returns the rows
 * date-ordered.
 *
 * The merged grant-date tranche also carries `scheduled` (#441): the pre-fold
 * partition of every row that landed on the grant date, globally date-ascending by
 * `scheduledDate`. It is emitted ONLY when at least one of those positions sits
 * strictly before the grant date (something was genuinely pulled forward); a tranche
 * built only of native grant-date rows, and the `grantDate === undefined` path, stay
 * bare — byte-identical to before the field existed.
 */
export function coalesceAtGrantDate(
  rows: CoalesceRow[],
  grantDate: OCTDate | undefined,
): { date: OCTDate; amount: number; scheduled?: ScheduledFold[] }[] {
  const sorted = [...rows].sort(byDateOrderOccurrence);
  if (grantDate === undefined)
    return sorted.map((r) => ({ date: r.date, amount: r.amount }));

  // The rows are relocated, so none sit before `grantDate`: the grant-date rows
  // are the contiguous front of the sorted run, summed into one tranche.
  let grantSum = 0;
  let sawGrant = false;
  const grantFolds: ScheduledFold[] = [];
  const out: { date: OCTDate; amount: number; scheduled?: ScheduledFold[] }[] =
    [];
  for (const r of sorted) {
    if (eq(r.date, grantDate)) {
      grantSum += r.amount;
      sawGrant = true;
      // A row carries its own pre-fold list (a per-statement folded line forwards
      // it); a row without one is a native grant-date share, a singleton at its
      // own date.
      grantFolds.push(
        ...(r.scheduled ?? [{ scheduledDate: r.date, amount: r.amount }]),
      );
    } else {
      out.push({ date: r.date, amount: r.amount });
    }
  }
  if (sawGrant) {
    // The rows fed in pre-sorted by (date, statementOrder, occurrence) and each
    // row's own sublist is already scheduledDate-ascending, so this stable sort by
    // scheduledDate makes the concatenation globally ascending while a tie keeps
    // the statementOrder/occurrence order.
    grantFolds.sort((a, b) =>
      lt(a.scheduledDate, b.scheduledDate)
        ? -1
        : gt(a.scheduledDate, b.scheduledDate)
          ? 1
          : 0,
    );
    const pulledForward = grantFolds.some((s) =>
      lt(s.scheduledDate, grantDate),
    );
    out.unshift(
      pulledForward
        ? { date: grantDate, amount: grantSum, scheduled: grantFolds }
        : { date: grantDate, amount: grantSum },
    );
  }
  return out;
}

/**
 * Collapse a projection stream to one RESOLVED tranche per calendar date. Each
 * RESOLVED installment merges — summing `amount` — into the first-seen entry of
 * its date; later same-date duplicates drop out. UNRESOLVED / IMPOSSIBLE rows
 * carry a symbolic or absent position rather than a calendar date, so they pass
 * through untouched, keeping their original slot relative to the rows around them.
 * The merge only sums integers that are already there, so the stream total is
 * unchanged (an over-allocating stream still over-allocates by the same amount).
 *
 * Where two statements land installments on the same date — overlapping PLUS
 * arms, or an unrecoverable events-only grid — the raw per-arm stream carries
 * duplicate dates; this is what gives the three projection tools one strictly
 * date-increasing tranche list apiece.
 */
export function foldSameDateInstallments(
  installments: Installment[],
): Installment[] {
  const out: Installment[] = [];
  const firstByDate = new Map<OCTDate, ResolvedInstallment>();
  for (const inst of installments) {
    if (inst.state !== "RESOLVED") {
      out.push(inst);
      continue;
    }
    const seen = firstByDate.get(inst.date);
    if (seen) {
      seen.amount += inst.amount;
    } else {
      // A fresh copy so the running sum never mutates the caller's installment.
      const merged = { ...inst };
      firstByDate.set(inst.date, merged);
      out.push(merged);
    }
  }
  return out;
}
