// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`): `template`, `events`, or `unresolved`. This is the live
// evaluate path — `evaluateStatement`/`evaluateProgram` run through here.

import type {
  ChainedSchedule,
  EvaluationContextInput,
  Finding,
  Program,
  ScheduleExpr,
} from "@vestlang/types";
import {
  assertValidVestingScheduleTemplate,
  MAX_INSTALLMENTS,
} from "@vestlang/core";
import { assertNever, classifyAllocation, fracSum } from "@vestlang/utils";
import { createEvaluationContext } from "../utils.js";
import { resolveStatements, buildTemplate } from "./lower.js";
import type { StmtResolution } from "./lower.js";
import { classify } from "./classify.js";
import type { ResolveResult, ResolveVerdict } from "./types.js";

// How many installments a statement will materialize is structural — it's the
// `occurrences` read straight off the periodicity, no resolution required (a
// schedule-level selector contributes its largest arm). Reading it this way
// matters: resolution steps the chain cursor, which for an over-cap schedule
// runs the date past year 9999 and throws a date-range error first — so the cap
// has to be checked *before* any resolution, or the wrong error wins.
const scheduleExprOccurrences = (e: ScheduleExpr | ChainedSchedule): number => {
  switch (e.type) {
    case "SCHEDULE":
      return e.periodicity.occurrences;
    case "SCHEDULE_EARLIER_OF":
    case "SCHEDULE_LATER_OF":
      return Math.max(0, ...e.items.map(scheduleExprOccurrences));
    default:
      return assertNever(e);
  }
};

/** Bound the installments a program will materialize, before any resolution or
 *  per-occurrence build. The same structural measure is used by `resolveToCore`
 *  and by the per-statement MCP tools (`vestlang_evaluate` family, which map
 *  over statements separately and so wouldn't otherwise see a program that is
 *  individually-small but collectively huge), so all the evaluate tools agree on
 *  what they reject. */
export const assertProgramInstallmentCap = (program: Program): void => {
  const total = program.reduce(
    (sum, s) => sum + scheduleExprOccurrences(s.expr),
    0,
  );
  if (total > MAX_INSTALLMENTS) {
    throw new Error(
      `schedule expands to ${total} installments, exceeds the limit of ${MAX_INSTALLMENTS}`,
    );
  }
};

export const resolveToCore = (
  program: Program,
  ctxInput: EvaluationContextInput,
): ResolveResult => {
  // Reject an oversized program before resolving anything (see above).
  assertProgramInstallmentCap(program);

  const ctx = createEvaluationContext(ctxInput);
  const totalShares = ctx.grantQuantity;
  const resolutions = resolveStatements(program, ctx, totalShares);

  const build = buildTemplate(resolutions, ctx, totalShares);

  let verdict: ResolveVerdict;
  if (build.ok) {
    assertValidVestingScheduleTemplate(build.template);
    verdict = {
      kind: "template",
      template: build.template,
      runtime: build.runtime,
      totalShares: build.totalShares,
      sourceMap: build.sourceMap,
      blockers: build.blockers,
    };
  } else {
    // Resolves but doesn't fit one template (events) or can't materialize (unresolved).
    verdict = classify(build, program);
  }

  return {
    ...verdict,
    findings: allocationFindings(resolutions, totalShares),
  };
};

// Check how much of the grant the schedule allocates. We look here, before the
// result splits into a template or a bag of events, because that split is exactly
// where the cases diverge — a single `3/2` statement becomes a template, while
// `3/4 PLUS 3/4` becomes events — yet both are still visible as the same flat list of
// resolved statements, each carrying its share-of-grant fraction. Summing those
// fractions and comparing to the whole grant catches everything at once. Mixed
// quantity/portion programs come out in the wash too, since the share counts have
// already been lowered to fractions.
//
// Over the grant is an error — a grant can never vest more than 100% of itself. Under
// the grant is only a warning: leaving some of the grant unvested is a legal thing to
// write, just usually worth a heads-up.
const allocationFindings = (
  resolutions: StmtResolution[],
  totalShares: number,
): Finding[] => {
  // A grant of zero shares can't over- or under-allocate — there's nothing to
  // allocate against — so any sum is moot and we raise no finding.
  if (totalShares === 0) return [];

  const sum = fracSum(resolutions.map((r) => r.percentage));
  const where = classifyAllocation(sum);
  if (where === "over") {
    return [
      { kind: "over-allocation", severity: "error", sum, path: ["Program"] },
    ];
  }
  if (where === "under") {
    return [
      { kind: "under-allocation", severity: "warning", sum, path: ["Program"] },
    ];
  }
  return [];
};

export { rehydrate, reparseDefinition } from "./rehydrate.js";
export type { RehydrateResult } from "./rehydrate.js";
export {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
} from "./sidecar.js";
export type { Sidecar, PersistedArtifact } from "./sidecar.js";
export type { ResolveResult } from "./types.js";
export { resolveInterchange } from "./interchange.js";
