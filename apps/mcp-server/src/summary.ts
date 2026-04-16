import type { Installment, OCTDate } from "@vestlang/types";
import type { VestedResult } from "@vestlang/evaluator";

export interface Summary {
  total_vested: number;
  total_unvested: number;
  total_impossible: number;
  percent_vested: number;
  next_vest_date: OCTDate | null;
  next_vest_amount: number | null;
  fully_vested_date: OCTDate | null;
  cliff_date: OCTDate | null;
}

const sum = (xs: Installment[]) => xs.reduce((a, x) => a + x.amount, 0);

export function computeSummary(
  result: VestedResult,
  grantQuantity: number,
): Summary {
  const total_vested = sum(result.vested);
  const total_unvested = sum(result.unvested) + result.unresolved;
  const total_impossible = sum(result.impossible);

  const percent_vested =
    grantQuantity === 0
      ? 0
      : Math.round((total_vested / grantQuantity) * 10000) / 10000;

  const resolvedUnvested = result.unvested.filter(
    (i): i is Installment & { date: OCTDate } =>
      i.meta.state === "RESOLVED" && typeof i.date === "string",
  );

  // Arrays are already date-ordered by the evaluator, but sort defensively.
  const byDate = (a: { date: OCTDate }, b: { date: OCTDate }) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

  const nextResolved = [...resolvedUnvested].sort(byDate)[0] ?? null;
  const next_vest_date = nextResolved?.date ?? null;
  const next_vest_amount = nextResolved?.amount ?? null;

  const scheduleFullyResolved =
    result.unresolved === 0 &&
    result.impossible.length === 0 &&
    result.unvested.every((i) => i.meta.state === "RESOLVED");

  let fully_vested_date: OCTDate | null = null;
  if (scheduleFullyResolved) {
    const all = [...result.vested, ...resolvedUnvested].filter(
      (i): i is Installment & { date: OCTDate } => typeof i.date === "string",
    );
    if (all.length > 0) {
      fully_vested_date = all.sort(byDate)[all.length - 1]!.date;
    }
  }

  const resolvedVested = result.vested.filter(
    (i): i is Installment & { date: OCTDate } => typeof i.date === "string",
  );
  const cliff_date =
    resolvedVested.length > 0
      ? [...resolvedVested].sort(byDate)[0]!.date
      : null;

  return {
    total_vested,
    total_unvested,
    total_impossible,
    percent_vested,
    next_vest_date,
    next_vest_amount,
    fully_vested_date,
    cliff_date,
  };
}

export function filterByWindow(
  vested: Installment[],
  from: OCTDate,
  to: OCTDate,
): { installments: Installment[]; total: number } {
  const inWindow = vested.filter(
    (i) =>
      i.meta.state === "RESOLVED" &&
      typeof i.date === "string" &&
      i.date >= from &&
      i.date <= to,
  );
  return { installments: inWindow, total: sum(inWindow) };
}
