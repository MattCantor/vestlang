import {
  evaluateProgram,
  evaluateProgramWithContributions,
} from "@vestlang/evaluator";
import {
  inferSchedule,
  projectionResidual,
  type TrancheInput,
} from "@vestlang/inferrer";
import type {
  ResolutionContextInput,
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
//
// The inferrer's analytic core recovers a strict superset of the streams the old
// search did (its literal per-date fallback is projection-lossless), so rescue only
// widens: a program that used to rescue still does, and some that couldn't now can.
export function evaluateProgramWithRecovery(
  stmts: Program,
  ctx: ResolutionContextInput,
): RecoveryOutcome {
  // The collapse the public surface produces — one schedule carrying both the
  // closed-world resolves-to verdict and the firing-invariant storable verdict. It's both
  // the value we return when there's no rescue, and the only place the original
  // events-only reason survives: once we publish a recovered template, that
  // schedule carries no reason of its own. We evaluate WITH contributions on the
  // ORIGINAL author program, so the breakdown partition attributes to the author's
  // clauses whether or not we go on to rescue (the rescued headline still ties to
  // it — recovery only fires on an exact reproduction, residualError === 0).
  const { schedule, contributions } = evaluateProgramWithContributions(
    stmts,
    ctx,
  );
  const noRescue: RecoveryOutcome = { rescued: false, schedule, contributions };

  // Everything below the primary collapse is the recovery detour. The primary
  // stays outside the try so a genuine collapse failure — notably the #276
  // floorSharesAt refusal on an unrepresentable quotient — still surfaces; only
  // the detour degrades to noRescue. With the error-finding guard below in place,
  // recovery only runs on valid events-only programs, whose inferred re-eval
  // quantity is ≤ grant ≤ MAX_SAFE and so cannot overflow — so this catch has no
  // reachable trigger through the DSL surface and isn't unit-tested. It's
  // belt-and-suspenders against future inferrer edge cases or other unknown throw
  // sources, kept for the same reason clauseBreakdown keeps its blanket catch
  // (pipeline/run.ts): a recovery hiccup should degrade to "no rescue," never sink
  // a primary collapse that already succeeded.
  try {
    // Anything that already fits a template (or can't resolve yet) leaves here
    // untouched — no inference cost on the common path. The guard also narrows the
    // resolves-to union so the gate and the captured provenance read the structured
    // reason straight off the type.
    if (schedule.resolvesTo.status !== "events-only") return noRescue;

    // The #239 fix: don't recover an already-invalid program. Over-allocation is
    // an error-severity finding (under-allocation is only a warning), so this
    // gates exactly the invalid case. Inferring a template from an over-allocating
    // projection produces an over-grant quantity (150 VEST at grant 100) and
    // "rescues" the schedule into a clean template while the same schedule is
    // flagged valid:false — meaningless, contradictory output. Decline instead and
    // let the over-allocation finding stand.
    if (schedule.findings.some((f) => f.severity === "error")) return noRescue;

    const { reason, installments } = schedule.resolvesTo;

    if (!admitsRecovery(reason, installments, stmts)) return noRescue;

    // Project. The gate only admits firing-invariant programs (no event anchors),
    // so the stream is fully dated; the filter narrows the type rather than
    // dropping anything.
    const dated = installments.filter(
      (i): i is ResolvedInstallment => i.state === "RESOLVED",
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
    const published = evaluateProgram(inferred.program, reclassifiedCtx);
    // Recovery only runs on firing-invariant inputs, so the inferred template is
    // itself storable; the guard narrows the published resolves-to to the template
    // arm. Anything else and the inferred DSL didn't reclassify as one template.
    if (published.resolvesTo.status !== "template") return noRescue;
    // Rebuild with the narrowed resolves-to so the value matches the rescued-arm
    // type. Narrowing the nested `resolvesTo` doesn't re-type the whole object, so
    // we spread it back together explicitly.
    const rescued = { ...published, resolvesTo: published.resolvesTo };

    // Re-assert exact reproduction independently of the inferrer's own fit check.
    // This is what licenses flipping the verdict events-only → template: not just
    // "the inferred DSL fits the stream" but "the rescued template reproduces the
    // original projection exactly." Anything but a clean zero and we don't rescue.
    //
    // The rescued template's installments may now carry UNRESOLVED entries (the
    // pending-installments channel). Behaviorally a no-op here — the recovery gate
    // only admits firing-invariant programs, so no pending portions can appear — but
    // the type no longer guarantees it, so we filter to RESOLVED to keep the call
    // well-typed.
    const rescuedDated = published.resolvesTo.installments.filter(
      (i): i is ResolvedInstallment => i.state === "RESOLVED",
    );
    const residualError = projectionResidual(dated, rescuedDated);
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
      // The original program's partition (pre-rescue), so the breakdown still
      // attributes to the author's clauses, not the synthesized template's segments.
      contributions,
    };
  } catch {
    return noRescue;
  }
}
