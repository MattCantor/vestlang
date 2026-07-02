// Closed-form solvers behind the analytic inverter (see ./driver.ts for the
// narrative). Every function here is a pure function of ISO dates and integers —
// no evaluation, no I/O — so the family generators can hypothesize candidate
// template parameters and let one real evaluation per candidate arbitrate.
//
// The month lattice is read directly off the ISO strings (monthIdx/dayOf), and
// month stepping goes through the engine's own `addMonthsRule` so a candidate
// grid is validated against exactly the dates the evaluator would place.

import { addMonthsRule } from "@vestlang/primitives";
import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";

export const DEFAULT_DOM: VestingDayOfMonth = "VESTING_START_DAY";

export interface Row {
  date: OCTDate;
  amount: number;
}

// ---- ISO-string date lattice ---------------------------------------------------

/** Calendar-month index (year*12 + month-1) — the convention-invariant lattice
 *  the whole decomposition reasons on. */
export function monthIdx(iso: OCTDate): number {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return y * 12 + (m - 1);
}

function dayOf(iso: OCTDate): number {
  return Number(iso.slice(8, 10));
}

function lastDayOfMonthIdx(mi: number): number {
  const y = Math.floor(mi / 12);
  const m = mi % 12;
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Compose an ISO date from a month index and a day, or null if the day doesn't
 *  exist in that month (day-32, or Feb 30). */
function isoAt(mi: number, day: number): OCTDate | null {
  const last = lastDayOfMonthIdx(mi);
  if (day < 1 || day > last) return null;
  const y = Math.floor(mi / 12);
  const m = (mi % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

export function divisorsDesc(n: number): number[] {
  const out: number[] = [];
  for (let d = n; d >= 1; d--) if (n % d === 0) out.push(d);
  return out;
}

/** Month-index deltas between consecutive dates; null when any pair shares a
 *  month (no usable month lattice). */
export function monthDeltas(mis: number[]): number[] | null {
  const out: number[] = [];
  for (let i = 1; i < mis.length; i++) {
    const d = mis[i] - mis[i - 1];
    if (d <= 0) return null;
    out.push(d);
  }
  return out;
}

// ---- day-of-month candidate derivation (pattern-derived from the day pattern) --

export interface DomCand {
  dom: VestingDayOfMonth;
  /** Day the start date must carry so the policy reproduces the pattern (for the
   *  origin-reading policies). FIRST/LAST ignore it. */
  originDay: number;
  /** MINUS_ONE with a day-1 origin underflows to the PRIOR month's last day, so
   *  observed months sit one earlier than the grid's target months. */
  underflow: boolean;
}

/** Ordered day-of-month hypotheses read off the day pattern of the grid rows.
 *  Verification arbitrates; this order is the preference among policies that
 *  coincide on the observed dates. A supplied policy hint collapses the list to
 *  that single policy (trusted). */
export function domCandidates(
  dates: OCTDate[],
  hint?: VestingDayOfMonth,
): DomCand[] {
  const days = dates.map(dayOf);
  const ends = dates.map((d) => lastDayOfMonthIdx(monthIdx(d)));
  const allDay1 = days.every((d) => d === 1);
  const allMonthEnd = days.every((d, i) => d === ends[i]);
  const maxDay = Math.max(...days);

  const full: DomCand[] = (() => {
    if (allDay1) {
      return [
        { dom: "VESTING_START_DAY", originDay: 1, underflow: false },
        { dom: "FIRST_DAY_OF_MONTH", originDay: 1, underflow: false },
        { dom: "VESTING_START_DAY_MINUS_ONE", originDay: 2, underflow: false },
      ];
    }
    if (allMonthEnd) {
      // A varying month-end pattern reads naturally as LAST_DAY; a day-31 origin
      // under VESTING_START_DAY clamps to the same dates, and MINUS_ONE with a
      // day-1 origin underflows onto the prior month's end.
      return [
        { dom: "LAST_DAY_OF_MONTH", originDay: 31, underflow: false },
        { dom: "VESTING_START_DAY", originDay: 31, underflow: false },
        { dom: "VESTING_START_DAY_MINUS_ONE", originDay: 1, underflow: true },
      ];
    }
    const out: DomCand[] = [
      { dom: "VESTING_START_DAY", originDay: maxDay, underflow: false },
    ];
    if (maxDay + 1 <= 31)
      out.push({
        dom: "VESTING_START_DAY_MINUS_ONE",
        originDay: maxDay + 1,
        underflow: false,
      });
    return out;
  })();

  if (hint === undefined) return full;
  // A trusted hint keeps the derived origin/underflow for its policy if present,
  // else falls back to a plain reading (max observed day, no underflow).
  const matched = full.find((c) => c.dom === hint);
  if (matched) return [matched];
  return [{ dom: hint, originDay: maxDay, underflow: false }];
}

/** Concrete start date for a dom hypothesis in a given start month. FIRST/LAST
 *  don't read the origin day, so when the start month is the grant's month the
 *  grant date itself is used — that keeps the natural fromGrant reading first
 *  under the grant-alignment tiebreak. */
export function startISO(
  dc: DomCand,
  startMi: number,
  grantDate: OCTDate,
): OCTDate | null {
  if (dc.dom === "FIRST_DAY_OF_MONTH" || dc.dom === "LAST_DAY_OF_MONTH") {
    if (monthIdx(grantDate) === startMi) return grantDate;
    return isoAt(
      startMi,
      dc.dom === "FIRST_DAY_OF_MONTH" ? 1 : lastDayOfMonthIdx(startMi),
    );
  }
  return isoAt(startMi, dc.originDay);
}

// ---- month grids ---------------------------------------------------------------

/** Engine grid date: a statement anchored FROM `start`, its i-th occurrence. The
 *  origin is the start (the runtime startDate), exactly what the kernel does. */
export function gridDate(
  start: OCTDate,
  p: number,
  i: number,
  dom: VestingDayOfMonth,
): OCTDate {
  return addMonthsRule(start, i * p, dom, start);
}

/** Cheap date-only pre-check: every observed row date sits on the candidate grid,
 *  and the last grid point IS the last observed date (the final installment
 *  always survives allocation). Zero-amount holes are allowed. */
export function datesOnGrid(
  start: OCTDate,
  p: number,
  N: number,
  dom: VestingDayOfMonth,
  observed: OCTDate[],
): boolean {
  const grid = new Set<OCTDate>();
  let last: OCTDate = start;
  for (let i = 1; i <= N; i++) {
    last = gridDate(start, p, i, dom);
    grid.add(last);
  }
  if (last !== observed[observed.length - 1]) return false;
  for (const o of observed) if (!grid.has(o)) return false;
  return true;
}

/** Cliff length hitting the lump date from `start` under the policy — unique in
 *  months (the target month pins it), validated against the engine's own
 *  origin-blind cliff stepping. Never assumed on-cadence. */
export function cliffLengthFor(
  start: OCTDate,
  dc: DomCand,
  lumpDate: OCTDate,
): number | null {
  const L = monthIdx(lumpDate) - monthIdx(start) + (dc.underflow ? 1 : 0);
  if (L < 1) return null;
  return addMonthsRule(start, L, dc.dom, start) === lumpDate ? L : null;
}

// ---- monotone floor solve ------------------------------------------------------

/**
 * The folded-count solve shared by the cliff and pre-grant-fold families. When
 * `count` occurrences collapse into one lump (a cliff swallowing its hold, or
 * pre-grant mass folding onto the grant date), the lump carries the engine's
 * cumulative-round-down floor: `floor(total × count / (count + nOther))`, where
 * `nOther` is the surviving tail length. That floor is monotone non-decreasing in
 * `count`, so we scan upward, keep every `count` whose floor lands within the ±1
 * stored-truncation slack of the observed lump, and break once the floor passes
 * the lump for good.
 */
export function solveFloorCounts(
  total: number,
  lump: number,
  nOther: number,
  maxCount = 600,
): number[] {
  const out: number[] = [];
  for (let k = 1; k <= maxCount; k++) {
    const lo = Math.floor((total * k) / (k + nOther));
    if (Math.abs(lo - lump) <= 1) out.push(k);
    if (lo > lump + 1) break;
  }
  return out;
}

// ---- THEN segmentation (deviation: per-segment cadence) -------------------------

/**
 * Split a monotone monthly stream into back-to-back rate-change segments for a
 * THEN chain. A boundary opens where the amount jumps by ≥ 2 (allocation ripple
 * within one train moves by at most one share) OR where the month cadence
 * changes — and, unlike the committed search, each segment then derives its OWN
 * period from its own deltas, restoring the per-segment-cadence recovery. At
 * most three segments; null when there's no usable month lattice or the split
 * doesn't land in [2, 3] segments.
 *
 * The period of a multi-row segment is its (by construction uniform) internal
 * delta. A lone-row segment borrows the delta across its nearest boundary — the
 * step that led into it, or for a head segment the step leaving it — which is the
 * cadence the chain cursor would have to advance by; the forward chain-check and
 * the final real evaluation reject any borrowing that doesn't reproduce.
 */
export function segmentThen(
  rows: Row[],
): { rows: Row[]; period: number }[] | null {
  const n = rows.length;
  if (n < 2 || n > 80) return null;
  const mis = rows.map((r) => monthIdx(r.date));
  const deltas = monthDeltas(mis);
  if (deltas === null) return null;

  const stepDelta = (i: number): number => mis[i] - mis[i - 1]; // i >= 1
  const groups: Row[][] = [[rows[0]]];
  const groupIdx: number[][] = [[0]];
  for (let i = 1; i < n; i++) {
    const amountJump = Math.abs(rows[i].amount - rows[i - 1].amount) >= 2;
    const cadenceChange = i >= 2 && stepDelta(i) !== stepDelta(i - 1);
    if (amountJump || cadenceChange) {
      groups.push([]);
      groupIdx.push([]);
    }
    groups[groups.length - 1].push(rows[i]);
    groupIdx[groupIdx.length - 1].push(i);
  }
  if (groups.length < 2 || groups.length > 3) return null;

  const segs: { rows: Row[]; period: number }[] = [];
  for (let g = 0; g < groups.length; g++) {
    const idx = groupIdx[g];
    let period: number;
    if (idx.length >= 2) {
      period = mis[idx[1]] - mis[idx[0]];
    } else if (g > 0) {
      // lone row after a boundary: the step that led into it
      period = mis[idx[0]] - mis[idx[0] - 1];
    } else {
      // lone head row: the step leaving it toward the next segment
      period = mis[idx[0] + 1] - mis[idx[0]];
    }
    if (period < 1) return null;
    segs.push({ rows: groups[g], period });
  }
  return segs;
}

// ---- projection ----------------------------------------------------------------

export type Projection = { date: OCTDate; total: number }[];

const byCodeUnit = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

/** Sum same-date amounts and order by date (code-unit, ICU-independent). The
 *  decomposition path drops zero-total dates (matching the pipeline's
 *  `occupied()`); the projection path keeps them, since the evaluator never emits
 *  a zero installment anyway. This is the one bucket-by-date core both share. */
export function bucketByDate(stream: Row[], dropZero: boolean): Row[] {
  const byDate = new Map<OCTDate, number>();
  for (const { date, amount } of stream)
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  const rows = [...byDate.entries()].map(([date, amount]) => ({
    date,
    amount,
  }));
  return (dropZero ? rows.filter((r) => r.amount !== 0) : rows).sort((a, b) =>
    byCodeUnit(a.date, b.date),
  );
}

/** Per-date totals are the projection invariant the verifier compares on. */
export function aggregateProjection(stream: Row[]): Projection {
  return bucketByDate(stream, false).map(({ date, amount }) => ({
    date,
    total: amount,
  }));
}
