import { assemble, resolveToCore } from "@vestlang/evaluator";
import { inferSchedule, type TrancheInput } from "@vestlang/inferrer";
import type {
  EvaluationContextInput,
  Program,
  ResolvedInstallment,
} from "@vestlang/types";
import { admitsRecovery } from "./gate.js";
import type { RecoveryOutcome } from "./types.js";

// Evaluate a program, and where the classifier fell back to events-only purely
// because the authored structure isn't a single template, try to recover the
// template the realized projection actually has.
//
// The shape of the detour: classify → gate → infer → re-classify → attach. It's
// cheap-first — classify is the primary path, and the inference cost is only paid
// on the events-only fallback — and bounded: at most one inferSchedule + one
// re-classify, never a second rescue round.
export function evaluateProgramWithRecovery(
  stmts: Program,
  ctx: EvaluationContextInput,
): RecoveryOutcome {
  const r = resolveToCore(stmts, ctx);

  // Anything that already fits a template (or can't resolve yet) leaves here
  // untouched — no inference cost on the common path.
  if (r.kind !== "events") return { rescued: false, schedule: assemble(r) };

  // From here `r` is the events arm. Assemble it once: it's both the value we
  // return when there's no rescue, and the only place the original events-only
  // reason survives — once we publish a recovered template, that schedule carries
  // no reason of its own.
  const eventsSchedule = assemble(r);
  const reason =
    eventsSchedule.status === "events-only" ? eventsSchedule.reason : "";
  const noRescue: RecoveryOutcome = {
    rescued: false,
    schedule: eventsSchedule,
  };

  if (!admitsRecovery(r, stmts)) return noRescue;

  // Project: the events arm already carries the resolved {date, amount} stream.
  const tranches: TrancheInput[] = r.installments.map((i) => ({
    date: i.date,
    amount: i.amount,
  }));
  const inferred = inferSchedule({
    tranches,
    grantDate: ctx.events.grantDate,
  });

  // Re-classify the inferred program. The day-of-month convention isn't in the
  // DSL text, so it has to ride in as context for the projection to line up.
  const reclassified = resolveToCore(inferred.program, {
    ...ctx,
    vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
  });
  if (reclassified.kind !== "template") return noRescue;

  const published = assemble(reclassified);
  // assemble preserves a template verdict as status "template"; the guard is here
  // to narrow the type, not because the other branch is reachable.
  if (published.status !== "template") return noRescue;

  // Re-assert exact reproduction independently of the inferrer's own fit check.
  // This is what licenses flipping the verdict events-only → template: not just
  // "the inferred DSL fits the stream" but "the rescued template reproduces the
  // original projection exactly." Anything but a clean zero and we don't rescue.
  const residualError = residualBetween(r.installments, published.installments);
  if (residualError !== 0) return noRescue;

  return {
    rescued: true,
    schedule: published,
    recovered: {
      from: "events-only",
      reason,
      template: reclassified.template,
      runtime: reclassified.runtime,
      dsl: inferred.dsl,
      vestingDayOfMonth: inferred.diagnostics.vestingDayOfMonth,
      residualError,
    },
  };
}

// Total absolute share difference between two projections, bucketed by date. Zero
// iff they vest the same amounts on exactly the same dates.
function residualBetween(
  expected: ResolvedInstallment[],
  actual: ResolvedInstallment[],
): number {
  const byDate = new Map<string, number>();
  for (const i of expected)
    byDate.set(i.date, (byDate.get(i.date) ?? 0) + i.amount);
  for (const i of actual)
    byDate.set(i.date, (byDate.get(i.date) ?? 0) - i.amount);
  let residual = 0;
  for (const delta of byDate.values()) residual += Math.abs(delta);
  return residual;
}
