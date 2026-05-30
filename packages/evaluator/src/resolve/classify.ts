// Fidelity classification — the `events` and `unresolved` arms of ResolveResult.
//
//  - events: the program resolves to concrete dated amounts but doesn't fit one
//    template (independent non-chaining grids, or an event-anchored cliff). Each
//    statement is expanded to dated events, flattened, sorted, and allocated with
//    the single running cumulative (core's allocator) — facts preserved, intent lost.
//  - unresolved: a start/cliff can't be materialized yet. Reuses vestlang's
//    evaluator to produce the symbolic (dateless) installments + blockers.

import type {
  Blocker,
  EvaluationContext,
  OCTDate,
  Program,
  ResolvedInstallment,
} from "@vestlang/types";
import type { Fraction } from "@vestlang/core";
import {
  addPeriod,
  allocateExact,
  allocateVector,
  floorSharesAt,
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
import type {
  NonTemplateReason,
  ResolveResult,
  SymbolicInstallment,
} from "./types.js";

interface RawEv {
  date: string;
  fraction: Fraction;
  order: number;
  occ: number;
}

/**
 * Expand one resolved statement to its dated events (fraction-of-grant each),
 * honoring a time-based or (fired) event cliff — the same shape core's compile
 * produces, but per statement so independent grids can coexist.
 */
const expandResolution = (
  r: StmtResolution,
  order: number,
  ctx: EvaluationContext,
): RawEv[] => {
  if (r.start.state !== "RESOLVED") return [];
  const dom = ctx.vesting_day_of_month;
  const anchor = r.start.date;
  const { type, length: period, occurrences: N } = r.periodicity;
  const stmtFraction = r.percentage;
  const gridDate = (i: number): string => addPeriod(anchor, i * period, type, dom);
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
    cliffDate = addPeriod(anchor, r.cliff.cliff.length, r.cliff.cliff.period_type, dom);
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

/** The cliff date for a resolved statement (time-based or a fired event), if any. */
const cliffDateOf = (
  r: StmtResolution,
  ctx: EvaluationContext,
): string | undefined => {
  if (r.start.state !== "RESOLVED") return undefined;
  if (r.cliff.state === "RESOLVED") {
    return addPeriod(
      r.start.date,
      r.cliff.cliff.length,
      r.cliff.cliff.period_type,
      ctx.vesting_day_of_month,
    );
  }
  if (r.cliff.state === "EVENT") return ctx.events[r.cliff.eventId];
  return undefined;
};

/**
 * Loaded (non-cumulative) allocation: each statement is an independent N-way
 * split (allocateVector — the exact integer base+remainder, matching the legacy
 * allocator), mapped onto its grid, with the grant-date and cliff lumps folded.
 * No single running cumulative — loaded modes don't telescope across statements.
 */
const loadedEventsArm = (
  resolutions: StmtResolution[],
  ctx: EvaluationContext,
  totalShares: number,
  reason: NonTemplateReason,
): ResolveResult => {
  const dom = ctx.vesting_day_of_month;
  const byDate = new Map<string, number>();
  for (const r of resolutions) {
    if (r.start.state !== "RESOLVED") continue;
    const anchor = r.start.date;
    const { type, length: period, occurrences: N } = r.periodicity;
    const sq = floorSharesAt(totalShares, r.percentage);
    let dates = Array.from({ length: N }, (_, i) =>
      addPeriod(anchor, (i + 1) * period, type, dom),
    );
    let amounts = allocateVector(sq, N, ctx.allocation_type);
    if (ctx.events.grantDate) {
      ({ dates, amounts } = foldToGrantDate(dates, amounts, ctx.events.grantDate));
    }
    const cliffDate = cliffDateOf(r, ctx);
    if (cliffDate && gt(cliffDate, anchor)) {
      ({ dates, amounts } = foldToGrantDate(dates, amounts, cliffDate));
    }
    dates.forEach((d, i) => byDate.set(d, (byDate.get(d) ?? 0) + amounts[i]));
  }
  const installments: ResolvedInstallment[] = [...byDate.entries()]
    .filter(([, amt]) => amt !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, amount]) => makeResolvedInstallment(date as OCTDate, amount));
  return { kind: "events", installments, reason };
};

const eventsArm = (
  resolutions: StmtResolution[],
  ctx: EvaluationContext,
  totalShares: number,
  reason: NonTemplateReason,
): ResolveResult => {
  if (reason.kind === "LOADED_ALLOCATION") {
    return loadedEventsArm(resolutions, ctx, totalShares, reason);
  }
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
    installments.push(makeResolvedInstallment(e.date as OCTDate, amount));
  }
  return { kind: "events", installments, reason };
};

const unresolvedArm = (
  program: Program,
  ctx: EvaluationContext,
): ResolveResult => {
  const symbolic: SymbolicInstallment[] = [];
  const blockers: Blocker[] = [];
  for (const stmt of program) {
    const ev = unresolvedInstallments(stmt, ctx);
    for (const inst of ev.installments) {
      if (inst.meta.state !== "RESOLVED") symbolic.push(inst as SymbolicInstallment);
    }
    blockers.push(...ev.blockers);
  }
  return { kind: "unresolved", symbolic, blockers };
};

/** Map a non-template build to its fidelity verdict. */
export const classify = (
  build: Extract<TemplateBuild, { ok: false }>,
  program: Program,
): ResolveResult =>
  build.why === "unresolved"
    ? unresolvedArm(program, build.ctx)
    : eventsArm(build.resolutions, build.ctx, build.totalShares, build.reason);
