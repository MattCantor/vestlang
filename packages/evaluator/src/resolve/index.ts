// extended.resolve — runtime-aware resolver/classifier.
//
// Resolves a DSL program's combinators against runtime, then maps the result to
// one `ResolveVerdict` (discriminated by `kind` — see `./types.ts` for the arms,
// so this header can't drift as they change). This is the live evaluate path —
// `evaluateStatement`/`evaluateProgram` run through here.

import type {
  ResolutionContextInput,
  OCFVestingScheduleCliff,
  Finding,
  Fraction,
  OCTDate,
  Program,
  UnresolvedInstallment,
  OCFVestingTermsV2,
} from "@vestlang/types";
import {
  allocateWithProvenance,
  installmentCapMessage,
  lt,
  MAX_INSTALLMENTS,
} from "@vestlang/primitives";
import { expandTemplateToRawEvents } from "@vestlang/core";
import { programInstallmentTotal } from "@vestlang/walk";
import {
  allocationFindingsFromFractions,
  analyzePrecision,
  numericToFraction,
} from "@vestlang/utils";
import { createEvaluationContext } from "../utils.js";
import { makeResolvedInstallment } from "../interpret/makeTranches.js";
import { eventCaseFindings } from "./event-case.js";
import { resolveStatements, buildTemplate } from "./lower.js";
import type { StmtResolution } from "./lower.js";
import { classify, buildStatementContributions } from "./classify.js";
import { isDatedStart, symbolicClaims } from "./unresolved.js";
import type {
  ResolveResult,
  ResolveVerdict,
  StatementContribution,
} from "./types.js";

// The template arm's stored statement fractions, index-aligned to the resolutions.
// A cliff's basis on this arm must be the *stored* statement decimal the realizer
// multiplies by (`compile.ts`), not the exact internal fraction — the schedule-whole
// apportionment stores each statement as a gap between two rounded running totals, so
// the two diverge for multi-statement non-terminating schedules. `buildTemplate`
// pushes exactly one statement per resolution in loop order (`order = i+1`), so a
// plain map lines up with the resolutions without any realignment.
const storedStmtFractions = (template: OCFVestingTermsV2): Fraction[] =>
  template.statements.map((s) => numericToFraction(s.percentage));

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
  // repeating share like 1/3 only reaches the ten-place grid, and at some grant
  // sizes no point on that grid lands the lump the exact share calls for. Run the
  // analyzer over the stored cliff decimals against the fractions they were
  // rendered from, and warn where ten places genuinely can't express the schedule.
  // (The statement percentage isn't analyzed — it is apportioned schedule-whole, so
  // the single-cumulative allocator conserves the grant by construction.)
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
      ? storedStmtFractions(build.template)
      : undefined,
  });

  let verdict: ResolveVerdict;
  let contributions: StatementContribution[];
  if (build.ok) {
    // Expand + allocate once off the shared core expansion (which retains the
    // safe-integer guard and BOTH assertValid* checks — so the template/runtime is
    // validated here, replacing the standalone assertValidVestingScheduleTemplate
    // that used to sit on this line). `installments` is byte-identical to
    // core.compile; `contributions` carries the per-event provenance the breakdown
    // partition is built from.
    const alloc = allocateWithProvenance(
      expandTemplateToRawEvents(
        build.template,
        build.totalShares,
        build.runtime,
      ),
      build.totalShares,
      build.runtime.grantDate,
    );
    const installments = alloc.installments.map((t) =>
      makeResolvedInstallment(t.date, t.amount),
    );

    // The per-statement partition, seeded over the whole program. The pending
    // channel (the symbolic installments for statements whose start is still
    // pending — a contingent-start head and the pending-tails behind it, plus a
    // dated start whose event-held cliff hasn't fired) is exactly the non-dated
    // statements' slice of that partition, so we read it straight off rather than
    // re-running the producer. core.compile skips a contingent template (the
    // sentinel-skip), so these symbolic claims are what keep the held shares in the
    // stream — and they telescope to the same total the allocator delivers.
    const claims = symbolicClaims(resolutions, totalShares);
    contributions = buildStatementContributions(
      resolutions,
      alloc.contributions,
      claims,
      ctx,
    );
    const pendingInstallments: UnresolvedInstallment[] = contributions.flatMap(
      (c) =>
        c.installments.filter(
          (inst): inst is UnresolvedInstallment => inst.state === "UNRESOLVED",
        ),
    );

    verdict = {
      kind: "template",
      template: build.template,
      runtime: build.runtime,
      totalShares: build.totalShares,
      sourceMap: build.sourceMap,
      installments,
      blockers: build.blockers,
      pendingInstallments,
    };
  } else {
    // Doesn't fit one template: classify into the non-template arms (events /
    // unresolved, or the all-void rollup to impossible). See `classify`.
    const classified = classify(build);
    verdict = classified.verdict;
    contributions = classified.contributions;
  }

  // Read the literal user-supplied firings (`ctxInput.events`), not the rebuilt
  // null-prototype `ctx.events` — same key set, but the input is the honest source
  // and dodges any question about the prototype copy. This rides the resolves-to arm
  // by construction: the storable context carries no firings to compare against.
  return {
    ...verdict,
    findings: [
      ...allocationFindings(resolutions, totalShares),
      ...precision,
      ...eventCaseFindings(program, ctxInput.events),
    ],
    contributions,
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
// participates in the grant-whole apportionment — so it is written to the ten-place
// grid on its own, and at a large enough grant no grid point lands its lump. The
// realizer folds that lump on the cliff date through one running cumulative at grant
// scale, so the guard sizes its verdict the same way: `analyzePrecision` runs with
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
    storedStmtFractions?: Fraction[];
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

    pushCliffFinding(
      findings,
      r.cliff.cliff,
      r.cliff.cliffFraction,
      stmtFraction,
      grant,
      leading,
      ["statements", i, "cliff"],
    );
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

// Analyze one cliff's stored decimal against the exact share it was written from
// and, when the interchange can't hold that share well enough, push the warning.
// Three values flow in separately: the verdict runs at grant scale (`N = grant`,
// `basisScale = stmtFraction`), the cliff's own fraction is what the decimal is
// measured against, and the Finding reports the integer statement-share count
// `floor(stmtFraction × grant)` for the human message. The zero-basis skip (a
// statement covering no shares has no cliff lump to misallocate) is kept alongside
// the analyzer's positive-numerator precondition.
//
// Leading vs non-leading splits the verdict reading:
//   - Leading (the lump sorts first, vestedSoFar = 0): the grant-scale single floor
//     is exact, so the analyzer's verdict is trusted directly. Only
//     `not-representable` warns. The stored decimal is rounded UP at the write, so
//     it can never pay the lump short — a mismatch always means it pays a share or
//     two long, and the value that would land the count exactly depends on the
//     grant. Since the stored percentage has to be right at every grant, there is
//     nothing to tell the reader unless ten places can't land it at all.
//   - Non-leading (a sibling vests before the lump, so the realized lump is
//     path-dependent): no per-statement basis is exact, so the guard errs
//     conservative — warn unless the decimal is *provably* the cliff's exact share
//     (`exact` / `terminating`). The conservative finding omits `recommended` and is
//     flagged `conservative` so the message reads as a path-dependent warning rather
//     than a not-representable one.
const pushCliffFinding = (
  findings: Finding[],
  cliff: OCFVestingScheduleCliff,
  cliffFraction: Fraction,
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
  const verdict = analyzePrecision(
    percentage,
    cliffFraction,
    grant,
    stmtFraction,
  );

  if (leading) {
    if (verdict.kind !== "not-representable") return;
    findings.push({
      kind: "precision-insufficient",
      severity: "warning",
      percentage,
      shareCount,
      // The Finding's field predates the guard being handed the fraction; it is
      // now the exact share, not a guess at one.
      inferred: verdict.fraction,
      path,
    });
    return;
  }

  // Non-leading: warn unless the decimal is provably the cliff's exact share.
  // `exact` carries no fraction (no fractional digits) and has nothing to warn
  // about, so it's silent here too.
  if (verdict.kind === "exact" || verdict.kind === "terminating") return;
  findings.push({
    kind: "precision-insufficient",
    severity: "warning",
    percentage,
    shareCount,
    inferred: verdict.fraction,
    // Path-dependent lump — no fixed decimal is provably right for it.
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
export { resolveStorable } from "./storable.js";
