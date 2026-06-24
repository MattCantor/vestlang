// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one verdict (`status`): `template`, `events`, or `unresolved`. This is the live
// evaluate path — `evaluateStatement`/`evaluateProgram` run through here.

import type {
  ResolutionContextInput,
  Cliff,
  Finding,
  Fraction,
  OCTDate,
  Program,
  UnresolvedInstallment,
  VestingScheduleTemplate,
} from "@vestlang/types";
import {
  installmentCapMessage,
  lt,
  MAX_INSTALLMENTS,
} from "@vestlang/primitives";
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
import {
  isDatedStart,
  unresolvedInstallments,
  symbolicClaims,
} from "./unresolved.js";
import type { ResolveResult, ResolveVerdict } from "./types.js";

// The template arm's stored statement fractions, index-aligned to the resolutions
// (order = i+1). A cliff's basis on this arm must be the *stored* statement decimal
// the realizer multiplies by (`compile.ts`), not the exact internal fraction —
// #443's apportionment can bump a non-terminating share by an ulp, so the two
// diverge for multi-statement non-terminating schedules. A statement with no cliff
// (or a pure milestone) yields `undefined`; only cliff statements read it.
const storedStmtFractions = (
  template: VestingScheduleTemplate,
  count: number,
): (Fraction | undefined)[] => {
  const byOrder = new Map<number, Fraction>();
  for (const s of template.statements) {
    byOrder.set(s.order, numericToFraction(s.percentage));
  }
  return Array.from({ length: count }, (_, i) => byOrder.get(i + 1));
};

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

  // The precision guard: a cliff percentage is stored as a Numeric decimal, so a
  // repeating share like 1/3 can only be written truncated, and at some grant
  // sizes that truncation costs the cliff lump a share. Run the analyzer over the
  // stored cliff decimals and warn when the truncation misallocates the lump the
  // realizer actually folds on the cliff date. (The statement percentage isn't
  // analyzed any more — #443 apportions it schedule-whole, so the single-cumulative
  // allocator conserves the grant by construction.)
  //
  // Both arms run the same cliff pass over the per-statement `resolutions` — the
  // resolutions carry both the lowered cliff (its stored decimal and retained cliff
  // date) and the sibling start dates the leading test needs. They differ in two
  // ways. (1) The materialize gate: a non-template build (events / unresolved) reads
  // the cliff decimal back through the *live* projection, so it warns only for cliffs
  // under a dated start (a resolved cliff under a still-pending start never
  // materializes live — a warning there would be a false positive). A template build
  // is the storable form a vestlang-blind reader could materialize at any time, so it
  // runs the gate open. (2) The statement basis: the template realizer multiplies the
  // cliff by the *stored* statement decimal (`compile.ts`), the events realizer by the
  // exact `r.percentage` (`classify.ts`) — so on the template arm the guard's basis is
  // the stored, apportioned percentage, read off the built template by `order`.
  const precision = cliffPrecisionFindings(resolutions, totalShares, {
    materializeGate: !build.ok,
    storedStmtFractions: build.ok
      ? storedStmtFractions(build.template, resolutions.length)
      : undefined,
  });

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

// The cliff precision pass, run over the per-statement `resolutions` for both
// arms. A cliff percentage is a share *of its own statement* — it never
// participates in #443's grant-whole apportionment — so its truncated decimal can
// still cost the cliff lump a share within its statement's basis. The realizer
// folds that lump on the cliff date through one running cumulative at grant scale,
// so the guard sizes its verdict the same way: `analyzePrecision` runs with
// `N = grant` and `basisScale = stmtFraction`, one floor at grant scale, which
// reproduces the realized leading lump `floor(stmtFraction × decimal × grant)`.
//
// `materializeGate` distinguishes the arms. A non-template build's cliff is read
// back through the *live* projection (`classify.ts`'s `expandResolution`), which
// reads the stored decimal only when the start is dated (RESOLVED / committed
// floor) — so the gate skips a cliff under a still-pending start (it never
// materializes live; warning there would be a false positive). A template build is
// the storable form a vestlang-blind reader could materialize at any time, so it
// runs the gate open — every analyzable cliff is checked, including a
// contingent-start template's tail cliff whose start is still pending.
const cliffPrecisionFindings = (
  resolutions: StmtResolution[],
  grant: number,
  opts: {
    materializeGate: boolean;
    // The template arm's stored, schedule-whole-apportioned statement percentages,
    // index-aligned to `resolutions` (order = i+1). The cliff basis must match the
    // fraction the *realizer* multiplies by: the template realizer reads the stored
    // decimal (`compile.ts`), so on that arm the basis is this stored value, not the
    // exact internal fraction. Absent on the events / unresolved arm, whose realizer
    // (`classify.ts`) multiplies by the exact `r.percentage`.
    storedStmtFractions?: (Fraction | undefined)[];
  },
): Finding[] => {
  if (grant <= 0) return [];
  const findings: Finding[] = [];
  resolutions.forEach((r, i) => {
    if (opts.materializeGate && !isDatedStart(r)) return;

    // Only a RESOLVED time cliff is analyzed. An EVENT_HELD cliff is excluded: a
    // fired one folds proportionally (the lump = pre/N from grid accrual, the stored
    // decimal is never read), and an unfired one materializes no lump at all — so its
    // stored decimal can't misallocate anything, and a warning there would be the
    // exact false positive this guard exists to prevent. (NONE / UNRESOLVED /
    // IMPOSSIBLE have no stored time cliff to read.)
    if (r.cliff.state !== "RESOLVED") return;

    // The cliff's statement basis: the stored fraction on the template arm (matching
    // the realizer), else the exact `r.percentage`.
    const stmtFraction = opts.storedStmtFractions?.[i] ?? r.percentage;

    const leading = leads(r.cliff.cliffDate, i, resolutions);

    pushCliffFinding(findings, r.cliff.cliff, stmtFraction, grant, leading, [
      "statements",
      i,
      "cliff",
    ]);
  });
  return findings;
};

// The leading test: statement `i`'s cliff lump leads its merged position iff no
// event from any *other* materializing statement can sort before it. A statement
// never produces an event before its own start, so a sibling's start date is a
// sound lower bound on its earliest event; the lump leads iff its date is strictly
// earlier than every materializing sibling's start. On any tie, any sibling at or
// before the lump, or an unknown cliff date, treat it as non-leading (conservative).
// A sibling counts only when it materializes dated events (start RESOLVED or
// COMMITTED) — the same gate the realizer applies; a pending/void sibling
// contributes no dated event and can't precede the lump.
const leads = (
  cliffDate: OCTDate | undefined,
  i: number,
  resolutions: StmtResolution[],
): boolean => {
  if (cliffDate === undefined) return false;
  return resolutions.every((other, j) => {
    if (j === i) return true;
    // Only a materializing sibling can contribute a dated event; a pending/void one
    // can't precede the lump, so it doesn't constrain the leading test.
    if (!isDatedStart(other)) return true;
    return lt(cliffDate, other.start.date);
  });
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

// Analyze one cliff's stored decimal and, when it misallocates the lump, push the
// warning. Two values flow in separately: the verdict runs at grant scale
// (`N = grant`, `basisScale = stmtFraction`), while the Finding reports the integer
// statement-share count `floor(stmtFraction × grant)` for the human message. The
// zero-basis skip (a statement covering no shares has no cliff lump to misallocate)
// is kept alongside the analyzer's positive-numerator precondition.
//
// Leading vs non-leading splits the verdict reading:
//   - Leading (the lump sorts first, vestedSoFar = 0): the grant-scale single floor
//     is exact, so the analyzer's verdict is trusted directly — `misallocates` /
//     `not-representable` warn, everything else is silent. This kills both the false
//     positive and the false negative.
//   - Non-leading (a sibling vests before the lump, so the realized lump is
//     path-dependent): no per-statement basis is exact, so the guard errs
//     conservative — warn unless the decimal is *provably* exact for the cliff
//     (`exact` / `terminating` / `too-complex`, where the decimal carries no
//     truncated rounding intent). `precise-enough` is no longer a proof here, so it
//     warns. The conservative finding omits `recommended` (the leading-basis
//     recommendation wouldn't match the path-dependent lump) and is flagged
//     `conservative` so the message reads as a path-dependent warning, not a
//     not-representable one.
const pushCliffFinding = (
  findings: Finding[],
  cliff: Cliff,
  stmtFraction: Fraction,
  grant: number,
  leading: boolean,
  path: (string | number)[],
): void => {
  const shareCount = Math.floor(
    (stmtFraction.numerator * grant) / stmtFraction.denominator,
  );
  if (shareCount <= 0) return;

  const percentage = cliff.percentage;
  const verdict = analyzePrecision(percentage, grant, {
    num: stmtFraction.numerator,
    den: stmtFraction.denominator,
  });

  if (leading) {
    // Trust the grant-scale verdict directly: only the two warning kinds fire, and
    // they differ in just one field — `misallocates` carries the shorter decimal,
    // `not-representable` can't (no ≤10-place decimal lands it), so it stays unset.
    if (
      verdict.kind !== "misallocates" &&
      verdict.kind !== "not-representable"
    ) {
      return;
    }
    findings.push({
      kind: "precision-insufficient",
      severity: "warning",
      percentage,
      shareCount,
      inferred: inferredToFraction(verdict.inferred),
      ...(verdict.kind === "misallocates" && {
        recommended: verdict.recommended,
      }),
      path,
    });
    return;
  }

  // Non-leading: warn unless the decimal is provably exact for the cliff. `exact`
  // never carries an `inferred` field (no fractional digits), and there's nothing
  // to warn about, so it's silent here too.
  if (
    verdict.kind === "exact" ||
    verdict.kind === "terminating" ||
    verdict.kind === "too-complex"
  ) {
    return;
  }
  findings.push({
    kind: "precision-insufficient",
    severity: "warning",
    percentage,
    shareCount,
    inferred: inferredToFraction(verdict.inferred),
    // Path-dependent lump — no leading-basis recommendation can be trusted.
    conservative: true,
    path,
  });
};

export {
  rehydrate,
  reparseDefinition,
  RehydrateDefinitionError,
  isRehydrateDefinitionError,
  RehydrateMissingStartMarkerError,
  isRehydrateMissingStartMarkerError,
  RehydrateUnexpectedStartError,
  isRehydrateUnexpectedStartError,
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
