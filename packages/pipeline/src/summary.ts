// Roll-up numbers over an as-of evaluation: how much has vested, what's next,
// when it finishes. The field names are snake_case because this is response
// vocabulary (what a consumer prints/serializes), not the engine's vocabulary.

import type {
  Installment,
  OCTDate,
  ResolvedInstallment,
} from "@vestlang/types";
import type { VestedResult } from "@vestlang/evaluator";

export interface Summary {
  total_vested: number;
  total_unvested: number;
  total_impossible: number;
  percent_vested: number;
  next_vest_date: OCTDate | null;
  next_vest_amount: number | null;
  fully_vested_date: OCTDate | null;
}

// Total the shares across a list of installments.
const sumAmounts = (xs: Installment[]) => xs.reduce((a, x) => a + x.amount, 0);

export function computeSummary(
  result: VestedResult,
  grantQuantity: number,
  valid: boolean,
): Summary {
  const total_vested = sumAmounts(result.vested);
  const total_unvested = sumAmounts(result.unvested) + result.unresolved;
  const total_impossible = sumAmounts(result.impossible);

  // Kept honest even when the schedule over-allocates: percent_vested is the raw
  // total_vested / grant, so on an over-allocating program it reads above 1 (e.g.
  // 1.2 when 120% has vested). It is *deliberately decoupled* from
  // total_vested/grant being ≤ 1 in the invalid case — clamping to 1 would
  // misreport an over-allocator as "fully vested" and break the
  // percent === total_vested / grant identity. The verdict that the schedule
  // isn't legal is carried by `valid`/`findings`, not by trimming this number.
  const percent_vested =
    grantQuantity === 0
      ? 0
      : Math.round((total_vested / grantQuantity) * 10000) / 10000;

  const isResolved = (i: Installment): i is ResolvedInstallment =>
    i.state === "RESOLVED";

  const resolvedUnvested = result.unvested.filter(isResolved);

  // Arrays are already date-ordered by the evaluator, but sort defensively.
  const byDate = (a: { date: OCTDate }, b: { date: OCTDate }) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

  const nextResolved = [...resolvedUnvested].sort(byDate)[0] ?? null;
  const next_vest_date = nextResolved?.date ?? null;
  const next_vest_amount = nextResolved?.amount ?? null;

  const scheduleFullyResolved =
    result.unresolved === 0 &&
    result.impossible.length === 0 &&
    result.unvested.every(isResolved);

  // The completion date is the one field that asserts "the grant finished
  // vesting" — a false claim for a schedule that allocates more than the grant.
  // So it's the only field suppressed when invalid; the numbers above stay raw.
  let fully_vested_date: OCTDate | null = null;
  if (valid && scheduleFullyResolved) {
    const all = [...result.vested, ...resolvedUnvested].filter(isResolved);
    if (all.length > 0) {
      fully_vested_date = all.sort(byDate)[all.length - 1].date;
    }
  }

  return {
    total_vested,
    total_unvested,
    total_impossible,
    percent_vested,
    next_vest_date,
    next_vest_amount,
    fully_vested_date,
  };
}

export function filterByWindow(
  vested: Installment[],
  from: OCTDate,
  to: OCTDate,
): { installments: Installment[]; total: number } {
  const inWindow = vested.filter(
    (i) => i.state === "RESOLVED" && i.date >= from && i.date <= to,
  );
  return { installments: inWindow, total: sumAmounts(inWindow) };
}
