// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`): `template`, `events`, or `unresolved`. This is the live
// evaluate path — `evaluateStatement`/`evaluateProgram` run through here.

import type {
  ResolutionContextInput,
  Finding,
  Numeric,
  Program,
  UnresolvedInstallment,
  VestingScheduleTemplate,
} from "@vestlang/types";
import { installmentCapMessage, MAX_INSTALLMENTS } from "@vestlang/primitives";
import { assertValidVestingScheduleTemplate } from "@vestlang/core";
import { programInstallmentTotal } from "@vestlang/walk";
import {
  allocationFindingsFromFractions,
  analyzePrecision,
  numericToFraction,
} from "@vestlang/utils";
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
  // Reject an oversized program before resolving anything (see above): the cap has
  // to run before resolution here, and it also backs this function's own direct
  // callers (the resolve tests). The structural / circular-start-gate guard
  // (#335 / #355) is enforced once at each public entry, so it isn't repeated here.
  assertProgramInstallmentCap(program);

  // The closed-world, here-and-now reading: read real firings AND let a partial
  // EARLIER_OF commit to its resolved floor.
  const ctx = createEvaluationContext(ctxInput, "resolution");
  const totalShares = ctx.grantQuantity;
  const resolutions = resolveStatements(program, ctx);

  const build = buildTemplate(resolutions, ctx);

  // The precision guard: a stored percentage is now a Numeric decimal, so a
  // repeating share can only be written truncated. Run the analyzer over the
  // built template's stored decimals and warn when the truncation misallocates
  // at this grant size. Only a template carries stored Numeric percentages —
  // the events/unresolved arms keep exact internal fractions — so the guard runs
  // only on an ok build.
  const precision = build.ok
    ? precisionFindings(build.template, totalShares)
    : [];

  let verdict: ResolveVerdict;
  if (build.ok) {
    assertValidVestingScheduleTemplate(build.template);

    // Collect symbolic installments for statements whose start is still pending —
    // a contingent-start head (unfired atomic event / unsettled combinator) AND the
    // pending-tails chained behind it. core.compile skips the whole contingent
    // template (the sentinel-skip), so without this the tails' share claims would
    // vanish from the stream — the conservation bug a single-event-head THEN chain
    // would otherwise hit, now that such a chain is a `template` rather than
    // `unresolved`.
    //
    // Lump amounts come from the program-wide claim cursor, so pending claims +
    // compiled tranches telescope to the same total the allocator will deliver.
    //
    // Notes on what we discard from the producer:
    //  - Blockers: buildTemplate already gathered the contingent head's blockers
    //    onto build.blockers, and under a template-ok build every cliff is NONE
    //    or RESOLVED, so the producer would return the same blockers again —
    //    pushing them would duplicate every pending blocker.
    //  - The inst.state check is type narrowing, not filtering: a pending start
    //    produces only UNRESOLVED installments (one whole-portion lump, or
    //    start+N steps for a partially-settled combinator / a pending-tail).
    //  - A dated start whose event-held cliff hasn't fired is also collected: the
    //    whole grid is held, so core.compile emits nothing for it, and without this
    //    its claim would vanish from the stream. unresolvedInstallments renders it
    //    as the held (symbolic) tranches. A *fired* held cliff is materialized by
    //    core.compile instead, so it's excluded here.
    const claims = symbolicClaims(resolutions, totalShares);
    const pendingInstallments: UnresolvedInstallment[] = [];
    resolutions.forEach((r, i) => {
      const heldUnfired =
        r.cliff.state === "EVENT_HELD" && r.cliff.firing === undefined;
      if (
        r.start.state === "PENDING_EVENT" ||
        r.start.state === "SYNTHETIC_EVENT" ||
        r.chain.role === "pending-tail" ||
        heldUnfired
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
    findings: [...allocationFindings(resolutions, totalShares), ...precision],
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
const allocationFindings = (
  resolutions: StmtResolution[],
  totalShares: number,
): Finding[] =>
  allocationFindingsFromFractions(
    resolutions.map((r) => r.percentage),
    totalShares,
  );

// Run the precision analyzer over a built template's stored Numeric percentages
// and emit a warning finding for any that misallocates at the grant size.
//
// Share-count basis (the v1 semantics):
//   - a statement's percentage is a share of the whole grant → analyze against
//     `grant`;
//   - a cliff's percentage is a share *of its own statement*, so analyze against
//     that statement's share basis, floor(stmtFraction × grant). For a single
//     100% statement this is just the grant, matching the analyzer's own
//     (0.3333…, 36000) example.
const precisionFindings = (
  template: VestingScheduleTemplate,
  grant: number,
): Finding[] => {
  if (grant <= 0) return [];
  const findings: Finding[] = [];
  template.statements.forEach((s, i) => {
    const stmtFraction = numericToFraction(s.percentage);
    pushPrecisionFinding(findings, s.percentage, grant, ["statements", i]);

    if (s.cliff) {
      // floor(stmtFraction × grant): the shares this statement covers, which the
      // cliff takes a percentage of.
      const stmtShares = Math.floor(
        (stmtFraction.numerator * grant) / stmtFraction.denominator,
      );
      if (stmtShares > 0) {
        pushPrecisionFinding(findings, s.cliff.percentage, stmtShares, [
          "statements",
          i,
          "cliff",
        ]);
      }
    }
  });
  return findings;
};

// Convert the analyzer's BigInt fraction to the number-based Fraction the Finding
// carries. The inferred fraction is small for every case the guard surfaces (1/3
// and the like), so this never loses precision in practice.
const inferredToFraction = (f: {
  numerator: bigint;
  denominator: bigint;
}): { numerator: number; denominator: number } => ({
  numerator: Number(f.numerator),
  denominator: Number(f.denominator),
});

// Analyze one stored decimal against its share basis; on a misallocates /
// not-representable verdict, push the warning. The other verdicts (exact,
// terminating, precise-enough, too-complex) are silent — the decimal is faithful
// enough, or the analyzer declines to second-guess it.
const pushPrecisionFinding = (
  findings: Finding[],
  percentage: Numeric,
  shareCount: number,
  path: (string | number)[],
): void => {
  const verdict = analyzePrecision(percentage, shareCount);
  if (verdict.kind === "misallocates") {
    findings.push({
      kind: "precision-insufficient",
      severity: "warning",
      percentage,
      shareCount,
      inferred: inferredToFraction(verdict.inferred),
      recommended: verdict.recommended,
      path,
    });
  } else if (verdict.kind === "not-representable") {
    findings.push({
      kind: "precision-insufficient",
      severity: "warning",
      percentage,
      shareCount,
      inferred: inferredToFraction(verdict.inferred),
      // No ≤10-place decimal lands the intended count — leave recommended unset.
      path,
    });
  }
};

export {
  rehydrate,
  reparseDefinition,
  RehydrateDefinitionError,
  isRehydrateDefinitionError,
  RehydrateMissingStartMarkerError,
  isRehydrateMissingStartMarkerError,
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
