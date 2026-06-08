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
import {
  addPeriod,
  allocateEvents,
  expandGrid,
  type GridCliff,
  type RawEvent,
} from "@vestlang/core";
import { makeResolvedInstallment } from "../evaluate/makeTranches.js";
import { unresolvedInstallments } from "./unresolved.js";
import type { StmtResolution, TemplateBuild } from "./lower.js";
import type { NonTemplateReason, ResolveVerdict } from "./types.js";

/**
 * Expand one resolved statement to its dated fraction-of-grant events, honoring a
 * time-based or fired-event cliff. Same shared kernel core's compile uses, called
 * per statement so independent grids can coexist in the events arm.
 */
const expandResolution = (
  r: StmtResolution,
  order: number,
  ctx: EvaluationContext,
): RawEvent[] => {
  if (r.start.state !== "RESOLVED") return [];
  const anchor = r.start.date;
  // For a chain tail, `anchor` is the clamped handoff (Feb 28 off a Jan 31 head)
  // while `origin` keeps the chain's first day (the 31st), so the grid springs
  // back to the month-end where it can. A non-tail is its own origin.
  const origin = r.origin ?? anchor;
  const { type, length: period, occurrences } = r.periodicity;
  const dom = ctx.vesting_day_of_month;

  let cliff: GridCliff;
  if (r.cliff.state === "RESOLVED") {
    // A time-based cliff is a pure duration from the anchor (no origin).
    cliff = {
      kind: "fixed",
      date: addPeriod(
        anchor,
        r.cliff.cliff.length,
        r.cliff.cliff.period_type,
        dom,
      ),
      percentage: r.cliff.cliff.percentage,
    };
  } else if (r.cliff.state === "EVENT") {
    // An event cliff has no percentage of its own — the lump takes whatever share
    // of the grid lands at or before the firing. Unfired → no lump.
    const date = ctx.events[r.cliff.eventId];
    cliff = date ? { kind: "proportional", date } : { kind: "none" };
  } else {
    cliff = { kind: "none" };
  }

  return expandGrid({
    anchor,
    origin,
    period,
    periodType: type,
    occurrences,
    stmtFraction: r.percentage,
    statementOrder: order,
    dom,
    cliff,
  });
};

/**
 * Dated tranches for every resolved statement: expand each to dated
 * fraction-events and hand the lot to the kernel's allocator, which orders them,
 * turns the fractions into exact integer shares, and folds anything pre-grant onto
 * the grant date. Statements whose start didn't resolve contribute nothing.
 */
const resolvedInstallments = (
  resolutions: StmtResolution[],
  ctx: EvaluationContext,
  totalShares: number,
): ResolvedInstallment[] =>
  allocateEvents(
    resolutions.flatMap((r, i) => expandResolution(r, i + 1, ctx)),
    totalShares,
    ctx.events.grantDate,
  ).map((t) => makeResolvedInstallment(t.date, t.amount));

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
