// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`): `template`, `events`, or `unresolved`. This is the live
// evaluate path — `evaluateStatement`/`evaluateProgram` run through here.

import type {
  ResolutionContextInput,
  Finding,
  Fraction,
  OCTDate,
  Program,
  UnresolvedInstallment,
  VestingDayOfMonth,
  VestingScheduleTemplate,
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
import { assertEvaluableProgram } from "../guard.js";
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
 *  wrong error wins. The same measure backs `resolveToCore` and
 *  `evaluateClauseGroups`, which asserts it once over the whole program before
 *  resolving each THEN chain separately — so a program that is small per chain
 *  but collectively huge is still caught. */
export const assertProgramInstallmentCap = (program: Program): void => {
  const total = programInstallmentTotal(program);
  if (total > MAX_INSTALLMENTS) {
    throw new Error(installmentCapMessage(total));
  }
};

export const resolveToCore = (
  program: Program,
  ctxInput: ResolutionContextInput,
): ResolveResult => {
  // Reject a malformed or circular-start-gated hand-built program before we read
  // any value off it (#335 / #355), then reject an oversized one (see above).
  assertEvaluableProgram(program);
  assertProgramInstallmentCap(program);

  // The closed-world, here-and-now reading: read real firings AND let a partial
  // EARLIER_OF commit to its resolved floor.
  const ctx = createEvaluationContext(ctxInput, "resolution");
  const totalShares = ctx.grantQuantity;
  const resolutions = resolveStatements(program, ctx);

  const build = buildTemplate(resolutions, ctx);

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
    resolutions.forEach((r, i) => {
      if (
        r.start.state === "PENDING_EVENT" ||
        r.start.state === "SYNTHETIC_EVENT"
      ) {
        for (const inst of unresolvedInstallments(r, ctx, claims[i])
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
    verdict = classify(build);
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
// one expression. An EVENT_FIRED cliff carries its landing spot directly as
// `effectiveAt`; an EVENT_PENDING one has no date to return.
const statementCliffDate = (
  r: StmtResolution,
  dom: VestingDayOfMonth,
): OCTDate | undefined => {
  if (r.cliff.state === "EVENT_FIRED") return r.cliff.effectiveAt;
  if (
    r.cliff.state === "RESOLVED" &&
    (r.start.state === "RESOLVED" || r.start.state === "COMMITTED")
  )
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

// The over/under-allocation rule, given the raw share-of-grant fractions. This is
// the single home for "does this schedule allocate the whole grant?" — both the
// live resolution path and the persisted-template re-check (in @vestlang/pipeline,
// guarding rehydrate) run their fractions through here, so the two can't drift on
// where the boundary sits or what the finding looks like.
//
// Over the grant is an error — a grant can never vest more than 100% of itself.
// Under the grant is only a warning: leaving some of the grant unvested is a legal
// thing to write, just usually worth a heads-up.
//
// The `["Program"]` path is the AST node-path the resolution-path callers want;
// it's inert for the template path (the template carries no AST), but harmless
// there since downstream formatting reads only kind/sum/severity.
const allocationFindingsFromFractions = (
  fractions: Fraction[],
  totalShares: number,
): Finding[] => {
  // A grant of zero shares can't over- or under-allocate — there's nothing to
  // allocate against — so any sum is moot and we raise no finding.
  if (totalShares === 0) return [];

  const sum = fracSum(fractions);
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

// Check how much of the grant the schedule allocates. We look here, before the
// result splits into a template or a bag of events, because that split is exactly
// where the cases diverge — a single `3/2` statement becomes a template, while
// `3/4 PLUS 3/4` becomes events — yet both are still visible as the same flat list of
// resolved statements, each carrying its share-of-grant fraction. Summing those
// fractions and comparing to the whole grant catches everything at once. Mixed
// quantity/portion programs come out in the wash too, since the share counts have
// already been lowered to fractions.
const allocationFindings = (
  resolutions: StmtResolution[],
  totalShares: number,
): Finding[] =>
  allocationFindingsFromFractions(
    resolutions.map((r) => r.percentage),
    totalShares,
  );

// The same allocation check, run against a stored template rather than a live
// resolution: sum the statements' share-of-grant fractions and classify. This is
// what lets a persisted artifact be re-validated on rehydrate without re-resolving
// it — the authored percentages already carry everything the sum needs. Cliff
// percentages don't enter: a cliff's percentage is a share *of its own statement*,
// already bounded to [0,1], not an additional claim on the grant.
export const templateAllocationFindings = (
  template: VestingScheduleTemplate,
  totalShares: number,
): Finding[] =>
  allocationFindingsFromFractions(
    template.statements.map((s) => s.percentage),
    totalShares,
  );

export {
  rehydrate,
  reparseDefinition,
  RehydrateDefinitionError,
  isRehydrateDefinitionError,
} from "./rehydrate.js";
export type { RehydrateResult } from "./rehydrate.js";
export {
  SyntheticNamespaceError,
  isSyntheticNamespaceError,
} from "./synthetic.js";
export {
  VESTLANG_SIDECAR_NAMESPACE,
  toSidecar,
  fromSidecar,
  toPersisted,
  rehydratePersisted,
} from "./sidecar.js";
export type { PersistedArtifact } from "./sidecar.js";
export type { ResolveResult } from "./types.js";
export { resolveInterchange } from "./interchange.js";
