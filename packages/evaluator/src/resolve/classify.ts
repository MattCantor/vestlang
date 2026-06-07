// Verdict classification — the `events` and `unresolved` arms of ResolveResult.
//
//  - events: the program resolves to concrete dated amounts but doesn't fit one
//    template (independent non-chaining grids, or an event-anchored cliff). Each
//    statement is expanded to dated events, flattened, sorted, and allocated with
//    the single running cumulative (core's allocator). The facts survive; the
//    intent does not.
//  - unresolved: a start/cliff can't be materialized yet. Reuses vestlang's
//    evaluator to produce the symbolic (dateless) installments + blockers.

import type {
  Blocker,
  EvaluationContext,
  ImpossibleBlocker,
  ImpossibleInstallment,
  Program,
  ResolvedInstallment,
  SymbolicInstallment,
} from "@vestlang/types";
import type { Fraction } from "@vestlang/types";
import {
  addPeriod,
  allocateExact,
  foldToGrantDate,
  fracAdd,
  fracMul,
  fracReduce,
  fracSub,
  gt,
  ONE,
  ZERO,
} from "@vestlang/core";
import { makeResolvedInstallment } from "../evaluate/makeTranches.js";
import { unresolvedInstallments } from "./unresolved.js";
import type { StmtResolution, TemplateBuild } from "./lower.js";
import type { NonTemplateReason, ResolveVerdict } from "./types.js";

interface RawEv {
  date: string;
  fraction: Fraction;
  order: number;
  occ: number;
}

/**
 * Expand one resolved statement to its dated events (fraction-of-grant each),
 * honoring a time-based or (fired) event cliff. This is the same shape core's
 * compile produces, but per statement so independent grids can coexist.
 */
const expandResolution = (
  r: StmtResolution,
  order: number,
  ctx: EvaluationContext,
): RawEv[] => {
  if (r.start.state !== "RESOLVED") return [];
  const dom = ctx.vesting_day_of_month;
  const anchor = r.start.date;
  // For a chain tail, `anchor` is the clamped handoff (Feb 28 off a Jan 31 head)
  // while `origin` keeps the chain's first day (the 31st), so the grid below
  // springs back to the month-end where it can. A non-tail is its own origin.
  const origin = r.origin ?? anchor;
  const { type, length: period, occurrences: N } = r.periodicity;
  const stmtFraction = r.percentage;
  const gridDate = (i: number): string =>
    addPeriod(anchor, i * period, type, dom, origin);
  const ev = (date: string, fraction: Fraction, occ: number): RawEv => ({
    date,
    fraction,
    order,
    occ,
  });
  const evenGrid = (): RawEv[] => {
    const per = fracMul(stmtFraction, { numerator: 1, denominator: N });
    return Array.from({ length: N }, (_, i) => ev(gridDate(i + 1), per, i + 1));
  };

  // Resolve the cliff date + lump fraction (time-based, or a fired event cliff).
  let cliffDate: string | undefined;
  let cliffPct: Fraction | undefined;
  if (r.cliff.state === "RESOLVED") {
    cliffDate = addPeriod(
      anchor,
      r.cliff.cliff.length,
      r.cliff.cliff.period_type,
      dom,
    );
    cliffPct = r.cliff.cliff.percentage;
  } else if (r.cliff.state === "EVENT") {
    cliffDate = ctx.events[r.cliff.eventId]; // undefined if not fired
  }
  if (!cliffDate || !gt(cliffDate, anchor)) return evenGrid();

  const post: number[] = [];
  let m = 0;
  for (let i = 1; i <= N; i++) {
    if (gt(gridDate(i), cliffDate)) post.push(i);
    else m++;
  }
  if (m === 0) return evenGrid();

  const pct = cliffPct ?? fracReduce({ numerator: m, denominator: N });
  const out: RawEv[] = [ev(cliffDate, fracMul(stmtFraction, pct), 0)];
  const P = post.length;
  if (P > 0) {
    const per = fracMul(
      stmtFraction,
      fracMul(fracSub(ONE, pct), { numerator: 1, denominator: P }),
    );
    for (const i of post) out.push(ev(gridDate(i), per, i));
  }
  return out;
};

/** Aggregate amounts dated before the grant onto the grant date (the implicit
 *  cliff core.compile applies). Amounts are already integers, so this is an exact
 *  regroup of a date-sorted series — no re-allocation. No-op without a grant date. */
const foldResolvedToGrantDate = (
  installments: ResolvedInstallment[],
  ctx: EvaluationContext,
): ResolvedInstallment[] => {
  if (!ctx.events.grantDate) return installments;
  const folded = foldToGrantDate(
    installments.map((t) => t.date),
    installments.map((t) => t.amount),
    ctx.events.grantDate,
  );
  return folded.dates.map((d, i) =>
    makeResolvedInstallment(d, folded.amounts[i]),
  );
};

/**
 * Dated tranches for every resolved statement: expand each to dated
 * fraction-events, sort, and allocate with one running cumulative (core's
 * allocator). Pre-grant tranches fold onto the grant date — the same implicit
 * cliff core.compile applies. Statements whose start didn't resolve contribute
 * nothing (expandResolution skips them).
 */
const resolvedInstallments = (
  resolutions: StmtResolution[],
  ctx: EvaluationContext,
  totalShares: number,
): ResolvedInstallment[] => {
  const events = resolutions.flatMap((r, i) => expandResolution(r, i + 1, ctx));
  events.sort((a, b) =>
    a.date !== b.date
      ? a.date < b.date
        ? -1
        : 1
      : a.order !== b.order
        ? a.order - b.order
        : a.occ - b.occ,
  );

  let cumulative: Fraction = ZERO;
  let vestedSoFar = 0;
  const installments: ResolvedInstallment[] = [];
  for (const e of events) {
    cumulative = fracAdd(cumulative, e.fraction);
    const amount = allocateExact(totalShares, cumulative, vestedSoFar);
    if (amount === 0) continue;
    vestedSoFar += amount;
    installments.push(makeResolvedInstallment(e.date, amount));
  }
  return foldResolvedToGrantDate(installments, ctx);
};

const eventsArm = (
  resolutions: StmtResolution[],
  ctx: EvaluationContext,
  totalShares: number,
  reason: NonTemplateReason,
): ResolveVerdict => ({
  kind: "events",
  installments: resolvedInstallments(resolutions, ctx, totalShares),
  reason,
});

const unresolvedArm = (
  build: Extract<TemplateBuild, { why: "unresolved" }>,
  program: Program,
): ResolveVerdict => {
  const { ctx, totalShares } = build;
  const symbolic: SymbolicInstallment[] = [];
  const blockers: Blocker[] = [];
  // The fully-resolved siblings, kept to materialize their dated tranches below.
  const resolvedResolutions: StmtResolution[] = [];
  // Per-statement outcomes, tracked to decide whether the whole program is void.
  let sawImpossible = false; // a contradictory portion
  let sawPending = false; // an unfired-but-satisfiable portion
  let sawResolvedLive = false; // a fully-resolved portion
  program.forEach((stmt, i) => {
    // A THEN tail has no start of its own to re-resolve here; the cursor pre-pass
    // already handed it one, so we work from that resolution rather than the
    // start-from-scratch path below (which has nothing to go on).
    if (stmt.chained) {
      const tail = build.resolutions[i];
      if (tail.start.state === "RESOLVED") {
        // A date chain, or a chain off a fired event: the tail has a concrete
        // date, so let the resolved producer materialize its tranches.
        sawResolvedLive = true;
        resolvedResolutions.push(tail);
      } else {
        // A chain off an event that hasn't fired: the tail can't vest yet. It
        // contributes no tranches, only the blocker for what it's waiting on.
        sawPending = true;
        if (tail.start.state === "UNRESOLVED")
          blockers.push(...tail.start.blockers);
      }
      return;
    }
    const ev = unresolvedInstallments(stmt, ctx);
    // EMPTY only comes back from unresolvedInstallments' fully-resolved paths.
    // Those RESOLVED tranches are discarded there; collect the resolution so we
    // can materialize them via the resolved producer instead of dropping them.
    // (A vacuous 0-occurrence statement is also empty; treating it as live keeps
    // it from forcing `impossible` — the safe direction.)
    if (ev.installments.length === 0) {
      sawResolvedLive = true;
      resolvedResolutions.push(build.resolutions[i]);
    }
    for (const inst of ev.installments) {
      if (inst.meta.state === "IMPOSSIBLE") sawImpossible = true;
      else if (inst.meta.state === "UNRESOLVED") sawPending = true;
      if (inst.meta.state !== "RESOLVED")
        symbolic.push(inst as SymbolicInstallment);
    }
    blockers.push(...ev.blockers);
  });

  // Lossless rollup: collapse to `impossible` only when every portion is void —
  // nothing merely pending, nothing already resolving. A mix stays `unresolved`,
  // where the leaf-level IMPOSSIBLE installments still carry the dead portion's
  // truth. In this branch every symbolic installment is IMPOSSIBLE and every
  // blocker is an ImpossibleBlocker, so the narrowing casts hold.
  if (sawImpossible && !sawPending && !sawResolvedLive) {
    return {
      kind: "impossible",
      installments: symbolic as ImpossibleInstallment[],
      blockers: blockers as ImpossibleBlocker[],
    };
  }

  // A mixed program is still unresolved, but its projection includes the resolved
  // siblings' dated tranches (sorted) ahead of the dateless symbolic ones.
  const resolved = resolvedResolutions.length
    ? resolvedInstallments(resolvedResolutions, ctx, totalShares)
    : [];
  return {
    kind: "unresolved",
    installments: [...resolved, ...symbolic],
    blockers,
  };
};

/** Map a non-template build to its verdict. */
export const classify = (
  build: Extract<TemplateBuild, { ok: false }>,
  program: Program,
): ResolveVerdict =>
  build.why === "unresolved"
    ? unresolvedArm(build, program)
    : eventsArm(build.resolutions, build.ctx, build.totalShares, build.reason);
