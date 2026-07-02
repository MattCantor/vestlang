import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import type {
  EvaluatedSchedule,
  Installment,
  OCTDate,
  ResolutionContextInput,
  ResolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";

// Evaluate one DSL template through the independent public pipeline
// (parse → normalizeProgram → evaluateProgram) under a fixed grant, no events,
// and a chosen day-of-month policy. The round-trip oracle and the crash-
// containment suite both re-evaluate emitted DSL exactly this way.
export function evalUnder(
  dsl: string,
  grantDate: OCTDate,
  total: number,
  dom: VestingDayOfMonth,
): EvaluatedSchedule {
  const program = normalizeProgram(parse(dsl));
  const ctx: ResolutionContextInput = {
    grantDate,
    events: {},
    grantQuantity: total,
    vesting_day_of_month: dom,
  };
  return evaluateProgram(program, ctx);
}

// Keep RESOLVED installments, drop everything else, project to {date, amount} —
// the stream-extraction idiom the characterization test and infer.test share.
export function resolvedStream(
  sched: EvaluatedSchedule,
): { date: OCTDate; amount: number }[] {
  const items: Installment[] = sched.resolution.installments;
  return items
    .filter((i): i is ResolvedInstallment => i.state === "RESOLVED")
    .map((i) => ({ date: i.date, amount: i.amount }));
}

// Sum same-date amounts, then order by date. A recovered cover can split one
// input tranche across several same-date installments, so a raw-sequence compare
// would spuriously differ — only the per-date totals are the invariant. The sort
// is a plain code-unit compare, locale-independent so the ordering can't churn
// across CI environments with different ICU collations.
export function aggregateByDate(
  stream: { date: OCTDate; amount: number }[],
): { date: OCTDate; total: number }[] {
  const byDate = new Map<OCTDate, number>();
  for (const { date, amount } of stream)
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, total]) => ({ date, total }));
}
