// Analytic inverter spike — decompose → hypothesize → verify-with-the-real-evaluator.
//
// The invertibility study established that for single-statement templates every
// parameter is either exactly observable (total, prefix sums, month lattice) or
// pinned to a small candidate set (dom policy, cliff length, folded count). So
// instead of the committed inferrer's branch-and-bound cover search + arithmetic
// fold guards, this spike derives candidate templates in closed form and lets
// one real evaluation per candidate arbitrate. A candidate that throws scores
// out (never crashes the run); if nothing verifies, the literal per-date PLUS
// list keeps the projection invariant.
//
// Hypothesis families, in fixed preference order (sparser first):
//   plain uniform grid (incl. sub-occurrence zero-hole grids, N from lattice span)
//   < uniform DAYS grid
//   < cliff + tail (any month cliff length, engine's truncated-decimal lump)
//   < pre-grant fold (lump on grant date; plain first, then erased-cliff scan)
//   < THEN rate-change chain (≤3 segments, stretch)
//   < literal per-date fallback.
// Dom preference: pattern-derived, default (VESTING_START_DAY) first except where
// the day pattern itself argues otherwise (month-ends read as LAST_DAY), with a
// start==grantDate alignment tiebreak inside each structural hypothesis.

import { isDeepStrictEqual } from "node:util";
import { parse } from "@vestlang/dsl";
import { evaluateProgram } from "@vestlang/evaluator";
import { normalizeProgram } from "@vestlang/normalizer";
import { addMonthsRule } from "@vestlang/primitives";
import type {
  Installment,
  OCTDate,
  ResolutionContextInput,
  ResolvedInstallment,
  VestingDayOfMonth,
} from "@vestlang/types";
import {
  aggregateProjection,
  type InferrerFn,
  type Projection,
  type Tranche,
} from "./sweepRunner.ts";

const DEFAULT_DOM: VestingDayOfMonth = "VESTING_START_DAY";

// Hard stop on candidate evaluations per case, so a pathological scan can never
// hang the sweep. In practice the verified hit lands within the first handful.
const MAX_EVALS = 700;

// ---- small date helpers -------------------------------------------------------

function monthIdx(iso: OCTDate): number {
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

function isoAt(mi: number, day: number): OCTDate | null {
  const last = lastDayOfMonthIdx(mi);
  if (day < 1 || day > last) return null;
  const y = Math.floor(mi / 12);
  const m = (mi % 12) + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}` as OCTDate;
}

function addDaysIso(iso: OCTDate, days: number): OCTDate {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10) as OCTDate;
}

function daysBetween(a: OCTDate, b: OCTDate): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round(
    (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000,
  );
}

function gcd(a: number, b: number): number {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function divisorsDesc(n: number): number[] {
  const out: number[] = [];
  for (let d = n; d >= 1; d--) if (n % d === 0) out.push(d);
  return out;
}

// ---- dom candidate derivation ---------------------------------------------------

interface DomCand {
  dom: VestingDayOfMonth;
  /** Day the start date must carry so the policy reproduces the pattern (for the
   *  origin-reading policies). FIRST/LAST ignore it. */
  originDay: number;
  /** MINUS_ONE with a day-1 origin underflows to the PRIOR month's last day, so
   *  observed months sit one earlier than the grid's target months. */
  underflow: boolean;
}

/** Ordered dom hypotheses read off the day pattern of the grid rows. Verification
 *  arbitrates; the order is the preference among policies that coincide. */
function domCandidates(dates: OCTDate[]): DomCand[] {
  const days = dates.map(dayOf);
  const ends = dates.map((d) => lastDayOfMonthIdx(monthIdx(d)));
  const allDay1 = days.every((d) => d === 1);
  const allMonthEnd = days.every((d, i) => d === ends[i]);
  const maxDay = Math.max(...days);
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
    // day-1 origin underflows onto the prior month's end. Preference trades
    // clean between these — LAST first is the population call, reported.
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
}

/** Concrete start date for a dom hypothesis in a given start month. FIRST/LAST
 *  don't read the origin day, so when the start month is the grant's month the
 *  grant date itself is used — that keeps the natural fromGrant reading first
 *  under the grant-alignment tiebreak. */
function startISO(
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

// ---- candidates ------------------------------------------------------------------

interface Row {
  date: OCTDate;
  amount: number;
}

interface Candidate {
  dsl: string;
  dom: VestingDayOfMonth;
  /** For the grant-alignment tiebreak. */
  start: OCTDate | null;
}

/** Stable: candidates whose derived start IS the grant date first — the DSL's
 *  default anchor is the grant, so that reading is the natural one. */
function byGrantAlignment(cands: Candidate[], grantDate: OCTDate): Candidate[] {
  return [...cands].sort(
    (a, b) =>
      Number(a.start !== grantDate) - Number(b.start !== grantDate),
  );
}

function plainDsl(T: number, start: OCTDate, p: number, N: number): string {
  return `${T} VEST FROM DATE ${start} OVER ${N * p} months EVERY ${p} months`;
}

/** Engine grid date: statement anchored FROM `start`, i-th occurrence. origin =
 *  the runtime startDate = the FROM date, exactly what the kernel does. */
function gridDate(
  start: OCTDate,
  p: number,
  i: number,
  dom: VestingDayOfMonth,
): OCTDate {
  return addMonthsRule(start, i * p, dom, start);
}

/** Cheap date-only pre-check: every observed row date must sit on the candidate
 *  grid, and the last grid point must BE the last observed date (the final
 *  installment always survives allocation). Zero-amount holes are allowed. */
function datesOnGrid(
  start: OCTDate,
  p: number,
  N: number,
  dom: VestingDayOfMonth,
  observed: OCTDate[],
  observedFrom = 0,
): boolean {
  const grid = new Set<OCTDate>();
  let last: OCTDate = start;
  for (let i = 1; i <= N; i++) {
    last = gridDate(start, p, i, dom);
    grid.add(last);
  }
  if (last !== observed[observed.length - 1]) return false;
  for (let i = observedFrom; i < observed.length; i++)
    if (!grid.has(observed[i])) return false;
  return true;
}

/** Month-index deltas; null when any pair shares a month (no month lattice). */
function monthDeltas(mis: number[]): number[] | null {
  const out: number[] = [];
  for (let i = 1; i < mis.length; i++) {
    const d = mis[i] - mis[i - 1];
    if (d <= 0) return null;
    out.push(d);
  }
  return out;
}

// (a) plain uniform month grid, holes included -------------------------------------

function* plainMonthFamily(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
): Generator<Candidate> {
  const mis = rows.map((r) => monthIdx(r.date));
  const deltas = monthDeltas(mis);
  if (!deltas || deltas.length === 0) return;
  const g = deltas.reduce(gcd);
  const uniform = deltas.every((d) => d === deltas[0]);
  const dates = rows.map((r) => r.date);
  const doms = domCandidates(dates);
  const count = rows.length;

  const structural: { p: number; N: number; i1: number }[] = [];
  // No-hole reading first (sparsest: N = surviving count).
  if (uniform) structural.push({ p: deltas[0], N: count, i1: 1 });
  // Hole-y readings (only possible when T < N), sparsest cadence first.
  for (const p of divisorsDesc(g)) {
    const span = (mis[count - 1] - mis[0]) / p;
    for (let N = span + 1; N <= span + 45 && N <= 600; N++) {
      if (uniform && p === deltas[0] && N === count) continue;
      if (T >= N) {
        if (N !== count) continue; // no zeros possible, every grid point must survive
        if (!uniform || p !== deltas[0]) continue;
      }
      const i1 = N - span; // index of the first surviving occurrence
      if (Math.abs(i1 - Math.ceil(N / T)) > 1) continue;
      structural.push({ p, N, i1 });
    }
  }

  for (const s of structural) {
    const cands: Candidate[] = [];
    for (const dc of doms) {
      const startMi = mis[0] - s.i1 * s.p + (dc.underflow ? 1 : 0);
      const start = startISO(dc, startMi, grantDate);
      if (!start) continue;
      if (!datesOnGrid(start, s.p, s.N, dc.dom, dates)) continue;
      cands.push({
        dsl: plainDsl(T, start, s.p, s.N),
        dom: dc.dom,
        start,
      });
    }
    yield* byGrantAlignment(cands, grantDate);
  }
}

// (a') plain uniform DAYS grid ------------------------------------------------------

function* plainDaysFamily(rows: Row[], T: number): Generator<Candidate> {
  if (rows.length < 2 || T < rows.length) return;
  const dd: number[] = [];
  for (let i = 1; i < rows.length; i++)
    dd.push(daysBetween(rows[i - 1].date, rows[i].date));
  if (dd.some((d) => d !== dd[0]) || dd[0] < 1) return;
  const p = dd[0];
  const N = rows.length;
  const start = addDaysIso(rows[0].date, -p);
  yield {
    dsl: `${T} VEST FROM DATE ${start} OVER ${N * p} days EVERY ${p} days`,
    dom: DEFAULT_DOM,
    start,
  };
}

// (b) cliff + tail ------------------------------------------------------------------

/** Cliff length hitting the lump date from `start` under the policy — unique in
 *  months (the target month pins it), validated against the engine's own
 *  origin-blind cliff stepping. */
function cliffLengthFor(
  start: OCTDate,
  dc: DomCand,
  lumpDate: OCTDate,
): number | null {
  const L = monthIdx(lumpDate) - monthIdx(start) + (dc.underflow ? 1 : 0);
  if (L < 1) return null;
  return addMonthsRule(start, L, dc.dom, start) === lumpDate ? L : null;
}

function* cliffFamily(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
): Generator<Candidate> {
  if (rows.length < 2) return;
  const [lump, ...tail] = rows;
  const S1 = lump.amount;
  const tailDates = tail.map((r) => r.date);
  const tmis = tail.map((r) => monthIdx(r.date));
  if (monthIdx(tail[0].date) <= monthIdx(lump.date) && tail.length >= 1) {
    // lump must strictly precede the tail's month lattice
    if (tmis[0] <= monthIdx(lump.date)) return;
  }
  const doms = domCandidates(tailDates);
  const nTail = tail.length;
  const deltas = monthDeltas(tmis);
  if (deltas === null) return;

  // Regime A: full contiguous tail (indices m+1..N all survive).
  const pCandsA: number[] =
    nTail >= 2
      ? deltas.every((d) => d === deltas[0])
        ? [deltas[0]]
        : []
      : divisorsDesc(monthIdx(tail[0].date) - monthIdx(lump.date));
  for (const p of pCandsA) {
    const ms: number[] = [];
    for (let m = 1; m <= 600; m++) {
      const lo = Math.floor((T * m) / (m + nTail));
      if (Math.abs(lo - S1) <= 1) ms.push(m);
      if (lo > S1 + 1) break;
    }
    for (const m of ms) {
      const N = m + nTail;
      const cands: Candidate[] = [];
      for (const dc of doms) {
        const startMi = tmis[0] - (m + 1) * p + (dc.underflow ? 1 : 0);
        const start = startISO(dc, startMi, grantDate);
        if (!start) continue;
        const L = cliffLengthFor(start, dc, lump.date);
        if (L === null || L > N * p) continue;
        if (!datesOnGrid(start, p, N, dc.dom, tailDates)) continue;
        cands.push({
          dsl: `${plainDsl(T, start, p, N)} CLIFF ${L} months`,
          dom: dc.dom,
          start,
        });
      }
      yield* byGrantAlignment(cands, grantDate);
    }
  }

  // Regime B: hole-y tail (sub-occurrence totals). N from the tail span.
  if (nTail >= 2) {
    const g = deltas.reduce(gcd);
    for (const p of divisorsDesc(g)) {
      const span = (tmis[nTail - 1] - tmis[0]) / p;
      for (let N = span + 2; N <= span + 45 && N <= 600; N++) {
        if (T >= N) continue; // no holes possible; regime A covered it
        for (const dc of doms) {
          const startMi = tmis[nTail - 1] - N * p + (dc.underflow ? 1 : 0);
          const start = startISO(dc, startMi, grantDate);
          if (!start) continue;
          const L = cliffLengthFor(start, dc, lump.date);
          if (L === null || L > N * p) continue;
          // the lump must swallow at least one occurrence and sit before the
          // first surviving tail date
          if (!datesOnGrid(start, p, N, dc.dom, tailDates)) continue;
          yield {
            dsl: `${plainDsl(T, start, p, N)} CLIFF ${L} months`,
            dom: dc.dom,
            start,
          };
        }
      }
    }
  }
}

// (c) pre-grant fold ---------------------------------------------------------------

function* foldFamily(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
): Generator<Candidate> {
  if (rows.length < 2) return;
  const [head, ...tail] = rows;
  if (head.date !== grantDate) return; // the evaluator folds pre-grant mass ONTO the grant date
  const S1 = head.amount;
  const tailDates = tail.map((r) => r.date);
  const tmis = tail.map((r) => monthIdx(r.date));
  const doms = domCandidates(tailDates);
  const nTail = tail.length;
  const deltas = monthDeltas(tmis);
  if (deltas === null) return;
  const uniformTail = nTail >= 2 && deltas.every((d) => d === deltas[0]);
  const pA = nTail >= 2 ? (uniformTail ? deltas[0] : null) : null;

  interface FoldHyp {
    p: number;
    N: number;
    j: number; // occurrences folded into (or absorbed at) the grant date
    dc: DomCand;
    start: OCTDate;
  }

  const solveJ = (p: number): number[] => {
    const js: number[] = [];
    for (let j = 1; j <= 600; j++) {
      const lo = Math.floor((T * j) / (j + nTail));
      if (Math.abs(lo - S1) <= 1) js.push(j);
      if (lo > S1 + 1) break;
    }
    return js;
  };

  const hypsA: FoldHyp[] = [];
  if (pA !== null) {
    for (const j of solveJ(pA)) {
      const N = j + nTail;
      for (const dc of doms) {
        const startMi = tmis[0] - (j + 1) * pA + (dc.underflow ? 1 : 0);
        const start = startISO(dc, startMi, grantDate);
        if (!start) continue;
        if (!datesOnGrid(start, pA, N, dc.dom, tailDates)) continue;
        hypsA.push({ p: pA, N, j, dc, start });
      }
    }
  }

  // Regime B: hole-y tail. j read off the candidate grid against the grant date.
  const hypsB: FoldHyp[] = [];
  if (nTail >= 2) {
    const g = deltas.reduce(gcd);
    for (const p of divisorsDesc(g)) {
      const span = (tmis[nTail - 1] - tmis[0]) / p;
      for (let N = span + 2; N <= span + 45 && N <= 600; N++) {
        if (T >= N) continue;
        for (const dc of doms) {
          const startMi = tmis[nTail - 1] - N * p + (dc.underflow ? 1 : 0);
          const start = startISO(dc, startMi, grantDate);
          if (!start) continue;
          if (!datesOnGrid(start, p, N, dc.dom, tailDates)) continue;
          let j = 0;
          for (let i = 1; i <= N; i++)
            if (gridDate(start, p, i, dc.dom) <= grantDate) j = i;
          if (j < 1) continue;
          hypsB.push({ p, N, j, dc, start });
        }
      }
    }
  }

  // Plain (no-cliff) fold candidates first — sparsest reading.
  for (const h of byGrantAlignment(
    hypsA.map((h) => ({
      dsl: plainDsl(T, h.start, h.p, h.N),
      dom: h.dc.dom,
      start: h.start,
    })),
    grantDate,
  ))
    yield h;
  for (const h of hypsB)
    yield { dsl: plainDsl(T, h.start, h.p, h.N), dom: h.dc.dom, start: h.start };

  // Then the erased-cliff scan: a cliff whose date fell on/before the grant is
  // folded into the grant lump but still shifts the allocation by its stored
  // truncated-decimal percentage — scan cliff lengths, LONGEST first (the most
  // informative cliff consistent with folding), and let the evaluator arbitrate.
  const cliffHyps: FoldHyp[] = [...hypsA];
  // widen the regime-A j window by ±2: the cliff's truncation can move the lump
  // off the plain floor equation
  if (pA !== null) {
    const seen = new Set(hypsA.map((h) => `${h.j}|${h.dc.dom}`));
    const js = solveJ(pA);
    const extra = new Set<number>();
    for (const j of js) for (const d of [-2, -1, 1, 2]) if (j + d >= 1) extra.add(j + d);
    for (const j of extra) {
      const N = j + nTail;
      for (const dc of doms) {
        if (seen.has(`${j}|${dc.dom}`)) continue;
        const startMi = tmis[0] - (j + 1) * pA + (dc.underflow ? 1 : 0);
        const start = startISO(dc, startMi, grantDate);
        if (!start) continue;
        if (!datesOnGrid(start, pA, N, dc.dom, tailDates)) continue;
        cliffHyps.push({ p: pA, N, j, dc, start });
      }
    }
  }
  cliffHyps.push(...hypsB);
  for (const h of cliffHyps) {
    // largest cliff length whose date is still on/before the grant date
    const Lmax = Math.min(h.j * h.p + h.p - 1, h.N * h.p);
    for (let L = Lmax; L >= 1; L--) {
      const cliffDate = addMonthsRule(h.start, L, h.dc.dom, h.start);
      if (cliffDate > grantDate) continue;
      if (cliffDate <= h.start) break;
      yield {
        dsl: `${plainDsl(T, h.start, h.p, h.N)} CLIFF ${L} months`,
        dom: h.dc.dom,
        start: h.start,
      };
    }
  }
}

// (d) single-tranche degenerate ------------------------------------------------------

function* singleFamily(
  row: Row,
  T: number,
  grantDate: OCTDate,
): Generator<Candidate> {
  const d = row.date;
  const doms = domCandidates([d]);
  const cands: Candidate[] = [];
  for (const dc of doms) {
    const D = monthIdx(d) - monthIdx(grantDate) + (dc.underflow ? 1 : 0);
    if (D < 1) continue;
    // anchor at the grant — the natural single-occurrence reading
    if (addMonthsRule(grantDate, D, dc.dom, grantDate) === d) {
      cands.push({
        dsl: `${T} VEST FROM DATE ${grantDate} OVER ${D} months EVERY ${D} months`,
        dom: dc.dom,
        start: grantDate,
      });
    }
  }
  yield* cands;
  const dd = daysBetween(grantDate, d);
  if (dd >= 1)
    yield {
      dsl: `${T} VEST FROM DATE ${grantDate} OVER ${dd} days EVERY ${dd} days`,
      dom: DEFAULT_DOM,
      start: grantDate,
    };
  yield { dsl: `${T} VEST FROM DATE ${d}`, dom: DEFAULT_DOM, start: d };
}

// (e) STRETCH: THEN chain for rate-change streams (≤3 segments) -----------------------

function* thenFamily(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
): Generator<Candidate> {
  if (rows.length < 2 || rows.length > 80) return;
  const mis = rows.map((r) => monthIdx(r.date));
  const deltas = monthDeltas(mis);
  if (!deltas || deltas.some((d) => d !== deltas[0])) return;
  const p = deltas[0];
  // segment at rate change-points: allocation ripple within one statement moves
  // by at most 1 share, so a jump ≥ 2 marks a statement boundary
  const segs: Row[][] = [[rows[0]]];
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(rows[i].amount - rows[i - 1].amount) >= 2) segs.push([]);
    segs[segs.length - 1].push(rows[i]);
  }
  if (segs.length < 2 || segs.length > 3) return;
  const doms = domCandidates(rows.map((r) => r.date));
  const cands: Candidate[] = [];
  for (const dc of doms) {
    const startMi = mis[0] - p + (dc.underflow ? 1 : 0);
    const start = startISO(dc, startMi, grantDate);
    if (!start) continue;
    const parts = segs.map((seg, k) => {
      const q = seg.reduce((s, r) => s + r.amount, 0);
      const from = k === 0 ? `FROM DATE ${start} ` : "";
      return `${q} VEST ${from}OVER ${seg.length * p} months EVERY ${p} months`;
    });
    cands.push({ dsl: parts.join(" THEN "), dom: dc.dom, start });
  }
  yield* byGrantAlignment(cands, grantDate);
}

// ---- verification -------------------------------------------------------------------

function verifyCandidate(
  dsl: string,
  dom: VestingDayOfMonth,
  grantDate: OCTDate,
  total: number,
  target: Projection,
): boolean {
  try {
    const program = normalizeProgram(parse(dsl));
    const ctx: ResolutionContextInput = {
      grantDate,
      events: {},
      grantQuantity: total,
      vesting_day_of_month: dom,
    };
    const sched = evaluateProgram(program, ctx);
    const r = sched.resolution;
    if (r.status !== "template") return false;
    const items: Installment[] = r.installments;
    if (!items.every((i) => i.state === "RESOLVED")) return false;
    const stream: Tranche[] = (items as ResolvedInstallment[]).map((i) => ({
      date: i.date,
      amount: i.amount,
    }));
    return isDeepStrictEqual(aggregateProjection(stream), target);
  } catch {
    // A junk candidate (e.g. a Fraction-overflow cliff product) scores out; it
    // must never kill the inference.
    spikeStats.candidateThrows++;
    return false;
  }
}

// ---- driver --------------------------------------------------------------------------

function* candidates(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
): Generator<Candidate> {
  if (rows.length === 1) {
    yield* singleFamily(rows[0], T, grantDate);
    return;
  }
  yield* plainMonthFamily(rows, T, grantDate);
  yield* plainDaysFamily(rows, T);
  yield* cliffFamily(rows, T, grantDate);
  yield* foldFamily(rows, T, grantDate);
  yield* thenFamily(rows, T, grantDate);
}

function fallback(rows: Row[], grantDate: OCTDate): {
  dsl: string;
  vestingDayOfMonth: VestingDayOfMonth;
} {
  if (rows.length === 0)
    return { dsl: `0 VEST FROM DATE ${grantDate}`, vestingDayOfMonth: DEFAULT_DOM };
  return {
    dsl: rows.map((r) => `${r.amount} VEST FROM DATE ${r.date}`).join(" PLUS "),
    vestingDayOfMonth: DEFAULT_DOM,
  };
}

export interface SpikeStats {
  cases: number;
  evals: number;
  fallbacks: number;
  /** Candidate evaluations that THREW and were contained (scored out). */
  candidateThrows: number;
}

export const spikeStats: SpikeStats = {
  cases: 0,
  evals: 0,
  fallbacks: 0,
  candidateThrows: 0,
};

export const analyticInferrer: InferrerFn = (tranches, grantDate) => {
  spikeStats.cases++;
  try {
    const byDate = new Map<OCTDate, number>();
    for (const t of tranches)
      byDate.set(t.date, (byDate.get(t.date) ?? 0) + t.amount);
    const rows: Row[] = [...byDate.entries()]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const T = rows.reduce((s, r) => s + r.amount, 0);
    if (rows.length === 0 || T === 0) return fallback(rows, grantDate);
    const target = aggregateProjection(rows);
    const seen = new Set<string>();
    let evals = 0;
    for (const cand of candidates(rows, T, grantDate)) {
      const key = `${cand.dom}|${cand.dsl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (++evals > MAX_EVALS) break;
      spikeStats.evals++;
      if (verifyCandidate(cand.dsl, cand.dom, grantDate, T, target))
        return { dsl: cand.dsl, vestingDayOfMonth: cand.dom };
    }
    spikeStats.fallbacks++;
    return fallback(rows, grantDate);
  } catch {
    spikeStats.fallbacks++;
    return fallback(
      [...new Map(tranches.map((t) => [t.date, t] as const)).values()]
        .map((t) => ({ date: t.date, amount: t.amount }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
      grantDate,
    );
  }
};
