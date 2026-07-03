// The hypothesis families and the PREFERENCE POLICY the inferrer resolves ties
// with. Each family derives candidate template PARAMETERS in closed form and
// emits a typed candidate; the driver renders and lets one real evaluation
// arbitrate, and the FIRST candidate that reproduces the stream wins. When
// several readings project to the identical stream — and many do — the order
// alone decides which one the inferrer reports.
//
// These are population-level trades between projection-identical readings: the
// observed `{date, amount}` stream cannot distinguish them (the data doesn't
// record which template made it), so the policy picks the sparsest / most
// canonical reading for the population rather than a per-case ground truth.
//
// FAMILY ORDER (sparsest reading first):
//   plain uniform month grid  <  plain uniform DAYS grid  <  cliff + tail
//   <  pre-grant fold  <  THEN rate-change chain  <  (single-tranche degenerate,
//   a mutually-exclusive branch for a 1-row stream only)  <  literal per-date
//   fallback (projection-lossless; fires only when nothing else verifies).
//
// DAY-OF-MONTH ORDER, per observed day pattern (see `domCandidates` in
// ./solvers.ts). The default policy (VESTING_START_DAY) leads except on a
// month-end pattern, and MINUS_ONE is always last:
//   - every date on day 1     → VESTING_START_DAY, FIRST_DAY_OF_MONTH, MINUS_ONE
//   - every date a month-end  → LAST_DAY_OF_MONTH, VESTING_START_DAY(31), MINUS_ONE
//   - otherwise               → VESTING_START_DAY(max observed day), MINUS_ONE(+1)
// A supplied policy hint collapses this to the single trusted policy.
//
// TIEBREAKS within a family: a vesting start equal to the grant date beats an
// off-grant start (`byGrantAlignment` — the grant is the DSL's default anchor);
// among erased-cliff fold candidates, the longer cliff length is tried first.
//
// A family that can't read the stream yields nothing and the next one is tried.

import { addMonthsRule, addDays, daysBetween } from "@vestlang/primitives";
import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";
import type { Candidate } from "./emit.js";
import {
  bareLumpStmt,
  cliffStmt,
  plainUniformStmt,
  thenChainProgram,
} from "./emit.js";
import {
  cliffLengthFor,
  datesOnGrid,
  DEFAULT_DOM,
  divisorsDesc,
  domCandidates,
  type DomCand,
  gcd,
  gridDate,
  monthDeltas,
  monthIdx,
  type Row,
  segmentThen,
  solveFloorCounts,
  startISO,
} from "./solvers.js";

/** Stable: candidates whose derived start IS the grant date first — the DSL's
 *  default anchor is the grant, so that reading is the natural one. */
function byGrantAlignment(cands: Candidate[], grantDate: OCTDate): Candidate[] {
  return [...cands].sort(
    (a, b) => Number(a.start !== grantDate) - Number(b.start !== grantDate),
  );
}

// (a) plain uniform month grid, holes included -------------------------------------

function* plainMonthFamily(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
  hint?: VestingDayOfMonth,
): Generator<Candidate> {
  const mis = rows.map((r) => monthIdx(r.date));
  const deltas = monthDeltas(mis);
  if (!deltas || deltas.length === 0) return;
  const g = deltas.reduce(gcd);
  const uniform = deltas.every((d) => d === deltas[0]);
  const dates = rows.map((r) => r.date);
  const doms = domCandidates(dates, hint);
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
        if (N !== count) continue; // no zeros possible, every grid point survives
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
        program: [
          plainUniformStmt(T, start, { unit: "MONTHS", length: s.p }, s.N),
        ],
        dom: dc.dom,
        start,
        tag: "plain",
      });
    }
    yield* byGrantAlignment(cands, grantDate);
  }
}

// (a') plain uniform DAYS grid ------------------------------------------------------

function* plainDaysFamily(
  rows: Row[],
  T: number,
  hint?: VestingDayOfMonth,
): Generator<Candidate> {
  if (rows.length < 2 || T < rows.length) return;
  const dd: number[] = [];
  for (let i = 1; i < rows.length; i++)
    dd.push(daysBetween(rows[i - 1].date, rows[i].date));
  if (dd.some((d) => d !== dd[0]) || dd[0] < 1) return;
  const p = dd[0];
  const N = rows.length;
  const start = addDays(rows[0].date, -p);
  const dom = hint ?? DEFAULT_DOM; // days ignore the policy; report the hint if given
  yield {
    program: [plainUniformStmt(T, start, { unit: "DAYS", length: p }, N)],
    dom,
    start,
    tag: "plain",
  };
}

// (b) cliff + tail ------------------------------------------------------------------

function* cliffFamily(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
  hint?: VestingDayOfMonth,
): Generator<Candidate> {
  if (rows.length < 2) return;
  const [lump, ...tail] = rows;
  const S1 = lump.amount;
  const tailDates = tail.map((r) => r.date);
  const tmis = tail.map((r) => monthIdx(r.date));
  // the lump must strictly precede the tail's month lattice
  if (tmis[0] <= monthIdx(lump.date)) return;
  const doms = domCandidates(tailDates, hint);
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
    for (const m of solveFloorCounts(T, S1, nTail)) {
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
          program: [cliffStmt(T, start, { unit: "MONTHS", length: p }, N, L)],
          dom: dc.dom,
          start,
          tag: "cliff",
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
          if (!datesOnGrid(start, p, N, dc.dom, tailDates)) continue;
          yield {
            program: [cliffStmt(T, start, { unit: "MONTHS", length: p }, N, L)],
            dom: dc.dom,
            start,
            tag: "cliff",
          };
        }
      }
    }
  }
}

// (c) pre-grant fold ---------------------------------------------------------------

interface FoldHyp {
  p: number;
  N: number;
  j: number; // occurrences folded into (or absorbed at) the grant date
  dc: DomCand;
  start: OCTDate;
}

function* foldFamily(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
  hint?: VestingDayOfMonth,
): Generator<Candidate> {
  if (rows.length < 2) return;
  const [head, ...tail] = rows;
  if (head.date !== grantDate) return; // the evaluator folds pre-grant mass ONTO the grant
  const S1 = head.amount;
  const tailDates = tail.map((r) => r.date);
  const tmis = tail.map((r) => monthIdx(r.date));
  const doms = domCandidates(tailDates, hint);
  const nTail = tail.length;
  const deltas = monthDeltas(tmis);
  if (deltas === null) return;
  const uniformTail = nTail >= 2 && deltas.every((d) => d === deltas[0]);
  const pA = nTail >= 2 ? (uniformTail ? deltas[0] : null) : null;

  const hypsA: FoldHyp[] = [];
  if (pA !== null) {
    for (const j of solveFloorCounts(T, S1, nTail)) {
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
  yield* byGrantAlignment(
    hypsA.map((h) => ({
      program: [
        plainUniformStmt(T, h.start, { unit: "MONTHS", length: h.p }, h.N),
      ],
      dom: h.dc.dom,
      start: h.start,
      tag: "fold" as const,
    })),
    grantDate,
  );
  for (const h of hypsB)
    yield {
      program: [
        plainUniformStmt(T, h.start, { unit: "MONTHS", length: h.p }, h.N),
      ],
      dom: h.dc.dom,
      start: h.start,
      tag: "fold",
    };

  // Then the erased-cliff scan: a cliff whose date fell on/before the grant is
  // folded into the grant lump but still shifts the allocation by its stored
  // truncated-decimal percentage — scan cliff lengths, LONGEST first, and let the
  // evaluator arbitrate. The pre-grant anchor rides in the cliff statement's start.
  const cliffHyps: FoldHyp[] = [...hypsA];
  if (pA !== null) {
    // widen the regime-A j window by ±2: the cliff's truncation can move the lump
    // off the plain floor equation
    const seen = new Set(hypsA.map((h) => `${h.j}|${h.dc.dom}`));
    const extra = new Set<number>();
    for (const j of solveFloorCounts(T, S1, nTail))
      for (const d of [-2, -1, 1, 2]) if (j + d >= 1) extra.add(j + d);
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
        program: [
          cliffStmt(T, h.start, { unit: "MONTHS", length: h.p }, h.N, L),
        ],
        dom: h.dc.dom,
        start: h.start,
        tag: "fold",
      };
    }
  }
}

// (d) single-tranche degenerate (1-row streams only) ---------------------------------

function* singleFamily(
  row: Row,
  T: number,
  grantDate: OCTDate,
  hint?: VestingDayOfMonth,
): Generator<Candidate> {
  const d = row.date;
  const doms = domCandidates([d], hint);
  const cands: Candidate[] = [];
  for (const dc of doms) {
    const D = monthIdx(d) - monthIdx(grantDate) + (dc.underflow ? 1 : 0);
    if (D < 1) continue;
    // anchor at the grant — the natural single-occurrence reading
    if (addMonthsRule(grantDate, D, dc.dom, grantDate) === d) {
      cands.push({
        program: [
          plainUniformStmt(T, grantDate, { unit: "MONTHS", length: D }, 1),
        ],
        dom: dc.dom,
        start: grantDate,
        tag: "plain",
      });
    }
  }
  yield* cands;
  const dd = daysBetween(grantDate, d);
  const daysDom = hint ?? DEFAULT_DOM;
  if (dd >= 1)
    yield {
      program: [
        plainUniformStmt(T, grantDate, { unit: "DAYS", length: dd }, 1),
      ],
      dom: daysDom,
      start: grantDate,
      tag: "plain",
    };
  // The bare dated lump is the same shape the literal fallback emits, so it tags
  // `literal` — a one-off dated amount, not a recovered train.
  yield {
    program: [bareLumpStmt(T, d)],
    dom: daysDom,
    start: d,
    tag: "literal",
  };
}

// (e) THEN chain for rate-change streams (≤ 3 segments, per-segment cadence) ----------

/** Forward-simulate the chain the evaluator would build: the head grids from its
 *  vesting start; each continuation grids from the running cursor, taking its
 *  day-of-month from the chain origin. Returns the installment dates, or null on
 *  a date-range overflow. */
function simulateChain(
  start: OCTDate,
  segs: { rows: Row[]; period: number }[],
  dom: VestingDayOfMonth,
): OCTDate[] | null {
  const out: OCTDate[] = [];
  let cursor = start;
  try {
    for (const seg of segs) {
      const occ = seg.rows.length;
      for (let i = 1; i <= occ; i++)
        out.push(addMonthsRule(cursor, i * seg.period, dom, start));
      cursor = addMonthsRule(cursor, occ * seg.period, dom, start);
    }
  } catch {
    return null;
  }
  return out;
}

function* thenFamily(
  rows: Row[],
  grantDate: OCTDate,
  hint?: VestingDayOfMonth,
): Generator<Candidate> {
  const segs = segmentThen(rows);
  if (segs === null) return;
  const mis = rows.map((r) => monthIdx(r.date));
  const doms = domCandidates(
    rows.map((r) => r.date),
    hint,
  );
  const p0 = segs[0].period;

  const cands: Candidate[] = [];
  for (const dc of doms) {
    const startMi = mis[0] - p0 + (dc.underflow ? 1 : 0);
    const start = startISO(dc, startMi, grantDate);
    if (!start) continue;
    // boundaries chain-checked by cursor advance: the simulated chain must land
    // exactly on the observed dates
    const placed = simulateChain(start, segs, dc.dom);
    if (placed === null || placed.length !== rows.length) continue;
    if (placed.some((date, i) => date !== rows[i].date)) continue;
    const program = thenChainProgram(
      segs.map((s) => ({
        total: s.rows.reduce((a, r) => a + r.amount, 0),
        cadence: { unit: "MONTHS" as const, length: s.period },
        occurrences: s.rows.length,
      })),
      start,
    );
    cands.push({ program, dom: dc.dom, start, tag: "then-segment" });
  }
  yield* byGrantAlignment(cands, grantDate);
}

// ---- driver over all families ------------------------------------------------------

export function* candidates(
  rows: Row[],
  T: number,
  grantDate: OCTDate,
  hint?: VestingDayOfMonth,
): Generator<Candidate> {
  // A single row is a degenerate stream: the multi-row families can't read it, so
  // it gets its own mutually-exclusive branch (never appended after THEN).
  if (rows.length === 1) {
    yield* singleFamily(rows[0], T, grantDate, hint);
    return;
  }
  yield* plainMonthFamily(rows, T, grantDate, hint);
  yield* plainDaysFamily(rows, T, hint);
  yield* cliffFamily(rows, T, grantDate, hint);
  yield* foldFamily(rows, T, grantDate, hint);
  yield* thenFamily(rows, grantDate, hint);
}
