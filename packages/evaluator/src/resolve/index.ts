// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`): `template`, `events`, or `unresolved`. This is the live
// evaluate path — `evaluateStatement`/`evaluateProgram` run through here.

import type {
  EvaluationContextInput,
  Finding,
  OCTDate,
  Program,
  UnresolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";
import {
  addPeriod,
  assertValidVestingScheduleTemplate,
  installmentCapMessage,
  MAX_INSTALLMENTS,
} from "@vestlang/core";
import { programInstallmentTotal } from "@vestlang/walk";
import { classifyAllocation, fracSum } from "@vestlang/utils";
import { createEvaluationContext } from "../utils.js";
import { resolveStatements, buildTemplate } from "./lower.js";
import type { StmtResolution } from "./lower.js";
import { classify } from "./classify.js";
import { unresolvedInstallments, symbolicClaims } from "./unresolved.js";
import type { ResolveResult, ResolveVerdict } from "./types.js";

/** Bound the installments a program will materialize, before any resolution or
 *  per-occurrence build. The count is structural (`programInstallmentTotal` from
 *  @vestlang/walk — occurrences off the periodicity, a selector's largest arm),
 *  which is why it's safe to ask here: resolution steps the chain cursor, and for
 *  an over-cap schedule that runs the date past year 9999 and throws a date-range
 *  error first — so the cap has to be checked *before* any resolution, or the
 *  wrong error wins. The same measure backs `resolveToCore` and the per-statement
 *  MCP tools (`vestlang_evaluate` family, which map over statements separately and
 *  so wouldn't otherwise see a program that is individually-small but collectively
 *  huge), so all the evaluate tools agree on what they reject. */
export const assertProgramInstallmentCap = (program: Program): void => {
  const total = programInstallmentTotal(program);
  if (total > MAX_INSTALLMENTS) {
    throw new Error(installmentCapMessage(total));
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

    // Collect symbolic installments for statements whose start is still pending
    // (unfired atomic event or unsettled synthetic combinator). core.compile skips
    // these — no firing means no dated tranches — so their share claims would
    // otherwise vanish from the stream.
    //
    // Lump amounts come from the program-wide claim cursor, so pending claims +
    // compiled tranches telescope to the same total the allocator will deliver.
    //
    // Notes on what we discard from the producer:
    //  - Blockers: buildTemplate already gathered each pending start's blockers
    //    onto build.blockers, and under a template-ok build every cliff is NONE
    //    or RESOLVED, so the producer would return the same r.start.blockers
    //    again — pushing them would duplicate every pending blocker.
    //  - The inst.state check is type narrowing, not filtering: a non-RESOLVED
    //    start produces only UNRESOLVED installments (one whole-portion lump, or
    //    start+N steps for a partially-settled combinator).
    //  - PENDING_EVENT / SYNTHETIC_EVENT starts are never chained tails (a THEN
    //    tail's injected start is RESOLVED or UNRESOLVED), so no chained-tail
    //    rendering happens through this channel.
    const claims = symbolicClaims(resolutions, totalShares);
    const pendingInstallments: UnresolvedInstallment[] = [];
    program.forEach((stmt, i) => {
      const r = resolutions[i];
      if (
        r.start.state === "PENDING_EVENT" ||
        r.start.state === "SYNTHETIC_EVENT"
      ) {
        for (const inst of unresolvedInstallments(r, stmt, ctx, claims[i])
          .installments) {
          if (inst.state === "UNRESOLVED") pendingInstallments.push(inst);
        }
      }
    });

    verdict = {
      kind: "template",
      template: build.template,
      runtime: build.runtime,
      totalShares: build.totalShares,
      sourceMap: build.sourceMap,
      blockers: build.blockers,
      pendingInstallments,
    };
  } else {
    // Resolves but doesn't fit one template (events) or can't materialize (unresolved).
    verdict = classify(build, program);
  }

  return {
    ...verdict,
    findings: allocationFindings(resolutions, totalShares),
    // The cliff date is a property of the schedule, not of when we look at it.
    // We place it with the engine's own addPeriod so it lands exactly where the
    // projection drops the cliff lump.
    cliffDate: earliestCliffDate(resolutions, ctx.vesting_day_of_month),
  };
};

// Where a single statement's cliff lump lands, or undefined when the cliff can't
// be placed yet (or there is none).
//
// A duration cliff measures from the statement's start: lowerCliff already
// derived `length`/`period_type` by round-tripping that exact date back through
// addPeriod, so applying the same arithmetic here reproduces it. For a THEN tail,
// `start.date` is the handoff date — which is the very anchor lowerCliff measured
// against — so heads, tails, independent grids, and fired EVENT starts (whose
// `start.date` already folds in the firing and any offsets) all go through this
// one expression. A fired event cliff carries its landing spot directly as
// `effectiveAt`; an unfired one leaves it undefined.
const statementCliffDate = (
  r: StmtResolution,
  dom: VestingDayOfMonth,
): OCTDate | undefined => {
  if (r.cliff.state === "EVENT") return r.cliff.effectiveAt;
  if (r.cliff.state === "RESOLVED" && r.start.state === "RESOLVED")
    return addPeriod(
      r.start.date,
      r.cliff.cliff.length,
      r.cliff.cliff.period_type,
      dom,
    );
  // No cliff, or a cliff whose anchor (a pending start) isn't placeable yet.
  return undefined;
};

// Across the program's statements, the earliest cliff date we can actually place.
// Statements whose cliff exists but can't be placed yet (pending anchor, unfired
// event cliff) contribute nothing — their pending-ness is already surfaced via
// blockers. Null when no statement carries a placeable cliff.
const earliestCliffDate = (
  resolutions: StmtResolution[],
  dom: VestingDayOfMonth,
): OCTDate | null => {
  let earliest: OCTDate | null = null;
  for (const r of resolutions) {
    const d = statementCliffDate(r, dom);
    if (d !== undefined && (earliest === null || d < earliest)) earliest = d;
  }
  return earliest;
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
