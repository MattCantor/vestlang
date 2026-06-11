// Verdict classification — the `events` and `unresolved` arms of ResolveResult.
//
//  - events: the program resolves to concrete dated amounts but doesn't fit one
//    template (independent non-chaining grids, or a fired event-anchored cliff).
//    Each resolved statement is expanded to dated events, flattened, sorted, and
//    allocated with the single running cumulative (core's allocator). A sibling
//    portion still waiting on an event isn't dropped: its shares ride along as
//    symbolic installments, its witnesses as blockers. The facts survive; the
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
import type { ResolveVerdict } from "./types.js";

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
    // An event cliff has no percentage of its own — the lump takes whatever
    // share of the grid lands at or before its effective date (the firing plus
    // any offsets on the cliff anchor), read off the record. Unfired, the cliff
    // still gates every installment, so there are no dated tranches to emit;
    // the routing holds such portions back before this expander runs, and the
    // empty return keeps the failure mode "withheld", never "released".
    if (r.cliff.effectiveAt === undefined) return [];
    cliff = { kind: "proportional", date: r.cliff.effectiveAt };
  } else if (r.cliff.state === "NONE") {
    cliff = { kind: "none" };
  } else {
    // UNRESOLVED / IMPOSSIBLE: nothing here is datable. Only a vacuous
    // 0-occurrence statement legitimately reaches this with nothing to lose.
    return [];
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
    ctx.grantDate,
  ).map((t) => makeResolvedInstallment(t.date, t.amount));

/**
 * The events arm routes here when the *dated* part of the program forced it (a
 * second independent grid, a fired event cliff) — which says nothing about the
 * sibling portions. A statement whose start is still waiting (a pending event,
 * an unsettled combinator) passed buildTemplate's guards and must not vanish:
 * its shares are emitted as symbolic installments and its witnesses as
 * blockers, the same rendering the unresolved arm uses for a mixed program.
 */
const eventsArm = (
  build: Extract<TemplateBuild, { why: "events" }>,
  program: Program,
): ResolveVerdict => {
  const { ctx, totalShares, resolutions, reason } = build;
  const symbolic: SymbolicInstallment[] = [];
  const blockers: Blocker[] = [];
  const dated: StmtResolution[] = [];
  program.forEach((stmt, i) => {
    const r = resolutions[i];
    if (r.start.state === "RESOLVED") {
      dated.push(r);
      return;
    }
    // buildTemplate already poisons UNRESOLVED/IMPOSSIBLE starts to the
    // unresolved arm, and a pending chain head keeps its tails out of the
    // events build too — so what lands here is a pending event or synthetic
    // combinator start on a statement of its own.
    const ev = unresolvedInstallments(r, stmt, ctx);
    for (const inst of ev.installments) {
      if (inst.meta.state !== "RESOLVED")
        symbolic.push(inst as SymbolicInstallment);
    }
    blockers.push(...ev.blockers);
  });
  return {
    kind: "events",
    installments: [
      ...resolvedInstallments(dated, ctx, totalShares),
      ...symbolic,
    ],
    blockers,
    reason,
  };
};

// A portion is "void" when nothing can ever vest from it: a contradictory start,
// or a resolved start whose cliff is contradictory. A pending start is never void
// even with a dead cliff — it waits on the start before the cliff matters.
const isVoid = (r: StmtResolution): boolean =>
  r.start.state === "IMPOSSIBLE" ||
  (r.start.state === "RESOLVED" && r.cliff.state === "IMPOSSIBLE");

const unresolvedArm = (
  build: Extract<TemplateBuild, { why: "unresolved" }>,
  program: Program,
): ResolveVerdict => {
  const { ctx, totalShares, resolutions } = build;
  const symbolic: SymbolicInstallment[] = [];
  const blockers: Blocker[] = [];
  // The fully-resolved siblings, kept to materialize their dated tranches below.
  const resolvedResolutions: StmtResolution[] = [];
  program.forEach((stmt, i) => {
    const r = resolutions[i];
    // A THEN tail has no start of its own; the cursor pre-pass already handed it
    // one, so we work from that resolution rather than rendering it from scratch.
    // A tail whose chain head hasn't fired can't vest yet — it contributes no
    // tranches, only the blocker for what it's waiting on. A tail with a concrete
    // handoff date falls through to the shared rendering below: its own cliff can
    // still gate it (an unfired event cliff, a pending gate), the same as a
    // statement that anchors itself.
    if (stmt.chained && r.start.state !== "RESOLVED") {
      if (r.start.state === "UNRESOLVED") blockers.push(...r.start.blockers);
      return;
    }
    const ev = unresolvedInstallments(r, stmt, ctx);
    // EMPTY only comes back from the fully-resolved paths. Those RESOLVED tranches
    // are dropped there; collect the resolution so the resolved producer can
    // materialize them. (A vacuous 0-occurrence statement is also empty — treating
    // it as live keeps it out of the void rollup, the safe direction.)
    if (ev.installments.length === 0) {
      resolvedResolutions.push(r);
    }
    for (const inst of ev.installments) {
      if (inst.meta.state !== "RESOLVED")
        symbolic.push(inst as SymbolicInstallment);
    }
    blockers.push(...ev.blockers);
  });

  // Lossless rollup: collapse to `impossible` only when every portion is void.
  // A mix stays `unresolved`, where the leaf-level IMPOSSIBLE installments still
  // carry each dead portion's truth. When every portion is void, every symbolic
  // installment is IMPOSSIBLE (so the cast holds) and the blockers are exactly the
  // records' IMPOSSIBLE blockers — typed, no cast needed.
  if (resolutions.length > 0 && resolutions.every(isVoid)) {
    const impossibleBlockers: ImpossibleBlocker[] = [];
    for (const r of resolutions) {
      if (r.start.state === "IMPOSSIBLE")
        impossibleBlockers.push(...r.start.blockers);
      else if (r.cliff.state === "IMPOSSIBLE")
        impossibleBlockers.push(...r.cliff.blockers);
    }
    return {
      kind: "impossible",
      installments: symbolic as ImpossibleInstallment[],
      blockers: impossibleBlockers,
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
    : eventsArm(build, program);
