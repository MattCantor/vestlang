import {
  assemble,
  resolveToCore,
  resolveInterchange,
} from "@vestlang/evaluator";
import {
  inferSchedule,
  projectionResidual,
  type TrancheInput,
} from "@vestlang/inferrer";
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
  // The storable-floor verdict for the authored program, paired with every
  // schedule we assemble from `r` below.
  const interchange = resolveInterchange(stmts, ctx);

  // Anything that already fits a template (or can't resolve yet) leaves here
  // untouched — no inference cost on the common path.
  if (r.kind !== "events")
    return { rescued: false, schedule: assemble(r, interchange) };

  // From here `r` is the events arm. Assemble it once: it's both the value we
  // return when there's no rescue, and the only place the original events-only
  // reason survives — once we publish a recovered template, that schedule carries
  // no reason of its own.
  const eventsSchedule = assemble(r, interchange);
  const noRescue: RecoveryOutcome = {
    rescued: false,
    schedule: eventsSchedule,
  };
  // `assemble` produced the events-only arm from the events build above; the guard
  // narrows the published union so the gate and the captured provenance read the
  // structured reason straight off the type recover hands back.
  if (eventsSchedule.resolution.status !== "events-only") return noRescue;
  const { reason, installments } = eventsSchedule.resolution;

  if (!admitsRecovery(reason, installments, stmts)) return noRescue;

  // Project. The gate only admits firing-invariant programs (no event anchors),
  // so the stream is fully dated; the filter narrows the type rather than
  // dropping anything.
  const dated = installments.filter(
    (i): i is ResolvedInstallment => i.meta.state === "RESOLVED",
  );
  const tranches: TrancheInput[] = dated.map((i) => ({
    date: i.date,
    amount: i.amount,
  }));
  const inferred = inferSchedule({
    tranches,
    grantDate: ctx.grantDate,
  });

  // Re-classify the inferred program. The day-of-month convention isn't in the
  // DSL text, so it has to ride in as context for the projection to line up.
  const reclassifiedCtx = {
    ...ctx,
    vesting_day_of_month: inferred.diagnostics.vestingDayOfMonth,
  };
  const reclassified = resolveToCore(inferred.program, reclassifiedCtx);
  if (reclassified.kind !== "template") return noRescue;

  // The published schedule describes the inferred program now, so its storable
  // verdict comes from that program too — and since recovery only runs on
  // firing-invariant inputs, the inferred template is itself storable.
  const published = assemble(
    reclassified,
    resolveInterchange(inferred.program, reclassifiedCtx),
  );
  // assemble preserves a template verdict; the guard is here to narrow the type,
  // not because the other branch is reachable.
  if (published.resolution.status !== "template") return noRescue;
  // Rebuild with the narrowed resolution so the value matches the rescued-arm
  // type. Narrowing the nested `resolution` doesn't re-type the whole object, so
  // we spread it back together explicitly.
  const rescued = { ...published, resolution: published.resolution };

  // Re-assert exact reproduction independently of the inferrer's own fit check.
  // This is what licenses flipping the verdict events-only → template: not just
  // "the inferred DSL fits the stream" but "the rescued template reproduces the
  // original projection exactly." Anything but a clean zero and we don't rescue.
  const residualError = projectionResidual(
    dated,
    published.resolution.installments,
  );
  if (residualError !== 0) return noRescue;

  return {
    rescued: true,
    schedule: rescued,
    recovered: {
      from: "events-only",
      reason,
      dsl: inferred.dsl,
      vestingDayOfMonth: inferred.diagnostics.vestingDayOfMonth,
      residualError,
    },
  };
}
