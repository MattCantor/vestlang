// Deterministic generator for the round-trip oracle — the widened (v2) grid.
//
// Enumerates single-schedule DSL templates over a structured parameter space —
// no fast-check, no randomness — plus a handful of hand-pinned seeds and clean
// tripwires. Every case is a DSL string the oracle runs through `parse →
// normalizeProgram → evaluateProgram`; the actual evaluate/infer/re-evaluate
// round trip and the bucketing are the test's job (roundtripOracle.test.ts).
//
// The grid deliberately attacks the harmonic degeneracy an earlier flat grid
// suffered (every cadence divided every duration, every cliff sat on a cadence
// boundary, every start was day-1, MINUS_ONE was absent, no off-grid grant). It
// is a moderate CORE CROSS (axis interactions) plus PROBE SLICES (one axis swept
// richly, the others pinned at defaults). Ids are pure functions of the axis
// tuple, so a point reached by several slices dedupes to one case that remembers
// its slice memberships.
//
// Points that fail parse/eval or evaluate non-template / non-all-RESOLVED are
// NOT filtered here — the test prunes them (over this grid nothing prunes, but
// the try/catch stays non-vacuous). Widening the search = adding values to a
// slice here, nothing else.

import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";

/** Where the grant date sits relative to the schedule's vesting start.
 *  `offGridBackdated` puts the grant strictly BETWEEN two installment dates. */
export type OffsetMode = "fromGrant" | "backdated" | "offGridBackdated";

/** The six shape axes a grid point records. `startDate` is the schedule's
 *  vesting start (an earlier flat grid pinned it to day-1 2024-01-01). */
export interface GridParams {
  offset: OffsetMode;
  startDate: OCTDate;
  duration: number;
  cadence: number;
  cliff: number | null; // months; null = no cliff
  total: number;
  dom: VestingDayOfMonth;
}

/** A grid point carries its axis tuple; a hand-pinned seed carries a name + note
 *  instead, since a THEN chain or an off-grid cliff doesn't decompose into the
 *  same axes. */
export type CaseParams =
  | ({ kind: "grid" } & GridParams)
  | { kind: "seed"; seed: string; note: string };

export interface OracleCase {
  /** Stable, zero-padded id so the snapshot sorts numerically under a plain
   *  lexicographic compare and never churns. */
  id: string;
  dsl: string;
  /** The grant date the template is evaluated under — handed to `inferSchedule`
   *  so a cliff is recoverable as a cliff. */
  grantDate: OCTDate;
  /** Grant quantity for the evaluation; also the `<total>` in the DSL. */
  total: number;
  /** The original eval's day-of-month axis value. The recovered eval re-derives
   *  its own (infer searches it), so this is the *original* convention only. */
  dom: VestingDayOfMonth;
  params: CaseParams;
  /** Which probe slices / cross generated this tuple (dedup-merged). Empty for
   *  the hand-pinned seeds and tripwires. */
  slices: string[];
  /** Inside an earlier flat grid's axis ranges — the apples-to-apples subspace.
   *  false for seeds/tripwires. */
  v1Comparable: boolean;
}

// Defaults every probe slice pins unless it is the axis under sweep.
const DEFAULTS = {
  offset: "fromGrant" as OffsetMode,
  startDate: "2024-01-01" as OCTDate,
  dom: "VESTING_START_DAY" as VestingDayOfMonth,
  total: 100,
};

const ALL_DOMS: VestingDayOfMonth[] = [
  "VESTING_START_DAY",
  "FIRST_DAY_OF_MONTH",
  "LAST_DAY_OF_MONTH",
  "VESTING_START_DAY_MINUS_ONE",
];

// ---- date helpers (UTC, month-end clamped like the engine's month stepper) ---

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function addMonthsClamped(iso: OCTDate, months: number): OCTDate {
  const [y, m, d] = iso.split("-").map(Number);
  const idx = m - 1 + months;
  const ty = y + Math.floor(idx / 12);
  const tm = ((idx % 12) + 12) % 12;
  const daysInTarget = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return `${ty}-${pad(tm + 1, 2)}-${pad(Math.min(d, daysInTarget), 2)}`;
}

function addDays(iso: OCTDate, days: number): OCTDate {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Grant date per offset mode. `backdated` places the grant start + 6 months (so
 *  early installments fold onto the grant date). `offGridBackdated` pushes 14
 *  further days so the grant falls STRICTLY BETWEEN two installment dates. */
function grantDateFor(offset: OffsetMode, start: OCTDate): OCTDate {
  if (offset === "fromGrant") return start;
  const backdated = addMonthsClamped(start, 6);
  return offset === "backdated" ? backdated : addDays(backdated, 14);
}

// ---- id / dsl ---------------------------------------------------------------

const OFFSET_TAG: Record<OffsetMode, string> = {
  fromGrant: "0grant",
  backdated: "1backd",
  offGridBackdated: "2offgd",
};

function gridId(p: GridParams): string {
  const cliff = p.cliff === null ? "none" : pad(p.cliff, 2);
  return [
    `off-${OFFSET_TAG[p.offset]}`,
    `start-${p.startDate.slice(5).replace("-", "")}`,
    `dur-${pad(p.duration, 2)}`,
    `cad-${pad(p.cadence, 2)}`,
    `cliff-${cliff}`,
    `tot-${pad(p.total, 5)}`,
    `dom-${p.dom}`,
  ].join("__");
}

function buildDsl(p: GridParams): string {
  const from = p.offset === "fromGrant" ? "" : `FROM DATE ${p.startDate} `;
  const cl = p.cliff === null ? "" : ` CLIFF ${p.cliff} months`;
  return `${p.total} VEST ${from}OVER ${p.duration} months EVERY ${p.cadence} months${cl}`;
}

// ---- expected-ambiguous family 1 (a pure params predicate) ------------------

/** Family 1 of the information-theoretically irreducible cases: cliff ≥ duration.
 *  The whole grant collapses to a single lump at the cliff date, so every
 *  cadence/occurrence combination over the span projects identically — no
 *  inferrer can recover the *original* template, it recovers the single lump.
 *  Verified to never tag a clean case (see the harness hard assert). fam2
 *  (erased pre-grant cliff) and fam3 (dom-stamp pairs) are not params-decidable
 *  and are sourced in the harness (census / sub-bucket). */
export function isCliffGeDuration(p: GridParams): boolean {
  return p.cliff !== null && p.cliff >= p.duration;
}

// ---- comparability with an earlier flat grid --------------------------------

const V1_DURATIONS = new Set([12, 48]);
const V1_CADENCES = new Set([1, 3, 6, 12]);
const V1_CLIFFS = new Set<number | null>([null, 6, 12]);
const V1_TOTALS = new Set([96, 100, 1000]);
const V1_DOMS = new Set<VestingDayOfMonth>([
  "VESTING_START_DAY",
  "FIRST_DAY_OF_MONTH",
  "LAST_DAY_OF_MONTH",
]);

function isV1Comparable(p: GridParams): boolean {
  return (
    p.offset !== "offGridBackdated" &&
    p.startDate === "2024-01-01" &&
    V1_DURATIONS.has(p.duration) &&
    V1_CADENCES.has(p.cadence) &&
    V1_CLIFFS.has(p.cliff) &&
    V1_TOTALS.has(p.total) &&
    V1_DOMS.has(p.dom)
  );
}

// ---- slice machinery --------------------------------------------------------

type Slice = { tag: string; points: GridParams[] };

function cross(
  tag: string,
  axes: {
    offset: OffsetMode[];
    startDate: OCTDate[];
    pairs: [number, number][]; // [duration, cadence], duration % cadence === 0
    cliff: (number | null)[];
    total: number[];
    dom: VestingDayOfMonth[];
  },
): Slice {
  const points: GridParams[] = [];
  for (const offset of axes.offset)
    for (const startDate of axes.startDate)
      for (const [duration, cadence] of axes.pairs)
        for (const cliff of axes.cliff)
          for (const total of axes.total)
            for (const dom of axes.dom)
              points.push({
                offset,
                startDate,
                duration,
                cadence,
                cliff,
                total,
                dom,
              });
  return { tag, points };
}

const D = DEFAULTS;

// S1 — the zero-coverage case: cliffs OFF the cadence boundary. Off-boundary
// {1,5,7,13} against cadences {2,3,6}; on-boundary controls {6,12}; edge cliffs
// == duration and duration+1 (do they prune or degenerate?). Duration 24 keeps
// cliff 13 a strictly-interior off-boundary point.
function cliffProbe(): Slice[] {
  const out: Slice[] = [];
  for (const duration of [12, 24]) {
    const cliffs = [
      ...new Set([1, 5, 7, 13, 6, 12, duration, duration + 1]),
    ].sort((a, b) => a - b);
    out.push(
      cross(`cliff-probe-d${duration}`, {
        offset: ["fromGrant", "backdated"],
        startDate: [D.startDate],
        pairs: ([2, 3, 6] as const).map(
          (c) => [duration, c] as [number, number],
        ),
        cliff: cliffs,
        total: [96, 100],
        dom: [D.dom],
      }),
    );
  }
  return out;
}

// S2 — duration/cadence pairs beyond a harmonic {12,48}×{1,3,6,12}: prime
// durations, non-divisor-rich pairs, and the single-occurrence degenerate (12,12).
const DURCAD_PAIRS: [number, number][] = [
  [12, 1],
  [12, 3],
  [48, 12], // harmonic controls
  [12, 2],
  [12, 4],
  [11, 1],
  [13, 1],
  [30, 5],
  [36, 9],
  [12, 12],
];

function durcadProbe(): Slice {
  return cross("durcad-probe", {
    offset: ["fromGrant", "backdated"],
    startDate: [D.startDate],
    pairs: DURCAD_PAIRS,
    cliff: [null, 6],
    total: [96, 100, 1000],
    dom: [D.dom],
  });
}

// S3 — totals: controls plus a prime (97), a chain-of-lumps total (1070), and
// sub-occurrence totals (10, 5) that force zero-amount installments on the
// 48-step grids.
function totalProbe(): Slice {
  return cross("total-probe", {
    offset: ["fromGrant", "backdated"],
    startDate: [D.startDate],
    pairs: [
      [12, 1],
      [48, 1],
      [48, 3],
    ],
    cliff: [null, 12],
    total: [96, 100, 1000, 97, 10, 5, 1070],
    dom: [D.dom],
  });
}

// S4 — day-of-month edges: start day becomes an axis (mid-month, month-end)
// crossed with ALL FOUR policies, incl. the earlier-excluded MINUS_ONE (#503).
// Month-end starts exercise short-month clamping.
function domStartProbe(): Slice {
  return cross("dom-start-probe", {
    offset: ["fromGrant", "backdated"],
    startDate: ["2024-01-01", "2024-01-15", "2024-01-31"],
    pairs: [
      [12, 1],
      [12, 3],
    ],
    cliff: [null, 6, 12],
    total: [100, 1000],
    dom: ALL_DOMS,
  });
}

// S5 — offsets: the off-grid grant (strictly between two installment dates)
// beside the on-grid modes, on short and long grids.
function offsetProbe(): Slice {
  return cross("offset-probe", {
    offset: ["fromGrant", "backdated", "offGridBackdated"],
    startDate: [D.startDate],
    pairs: [
      [12, 1],
      [12, 3],
      [48, 12],
      [48, 3],
    ],
    cliff: [null, 6, 12],
    total: [100, 1000],
    dom: ["VESTING_START_DAY", "LAST_DAY_OF_MONTH"],
  });
}

// S6 — the core cross: interactions between off-boundary cliffs, non-harmonic
// pairs, awkward totals, month-end starts, all four policies, and all three
// offsets. Moderate on purpose — the probe slices carry the per-axis depth.
function coreCross(): Slice {
  return cross("core-cross", {
    offset: ["fromGrant", "backdated", "offGridBackdated"],
    startDate: ["2024-01-01", "2024-01-31"],
    pairs: [
      [12, 1],
      [12, 2],
      [12, 3],
      [36, 9],
    ],
    cliff: [null, 5, 6, 7, 12],
    total: [100, 97, 10],
    dom: ALL_DOMS,
  });
}

const SLICES: Slice[] = [
  ...cliffProbe(),
  durcadProbe(),
  totalProbe(),
  domStartProbe(),
  offsetProbe(),
  coreCross(),
];

/** The slice tags, in first-seen order — the coverage assert checks every one
 *  lands on ≥1 admitted entry. Declared from the slice list so a renamed slice
 *  is caught, not silently dropped. */
export const V2_SLICE_TAGS: string[] = SLICES.map((s) => s.tag);

/** Explicit per-axis value sets, DECLARED independently of the slices so that
 *  dropping a value from a slice fails the coverage assert loudly rather than
 *  shrinking the search silently. Kept in sync with the slice definitions above;
 *  a mismatch (a declared value the grid never emits) is itself a test failure. */
export const V2_AXIS_VALUES = {
  offset: ["fromGrant", "backdated", "offGridBackdated"] satisfies OffsetMode[],
  startDate: ["2024-01-01", "2024-01-15", "2024-01-31"] as OCTDate[],
  duration: [11, 12, 13, 24, 30, 36, 48],
  cadence: [1, 2, 3, 4, 5, 6, 9, 12],
  cliff: [null, 1, 5, 6, 7, 12, 13, 24, 25] as (number | null)[],
  total: [5, 10, 96, 97, 100, 1000, 1070],
  dom: ALL_DOMS,
};

/** The deduped grid, in first-seen slice order (deterministic). */
export function gridCases(): OracleCase[] {
  const byId = new Map<string, OracleCase>();
  for (const { tag, points } of SLICES) {
    for (const p of points) {
      const id = gridId(p);
      const existing = byId.get(id);
      if (existing) {
        if (!existing.slices.includes(tag)) existing.slices.push(tag);
        continue;
      }
      byId.set(id, {
        id,
        dsl: buildDsl(p),
        grantDate: grantDateFor(p.offset, p.startDate),
        total: p.total,
        dom: p.dom,
        params: { kind: "grid", ...p },
        slices: [tag],
        v1Comparable: isV1Comparable(p),
      });
    }
  }
  return [...byId.values()];
}

// Hand-pinned seeds for known-interesting shapes a grid point can't express — a
// THEN chain and a far-backdated grant don't fit the axes — so they're spelled
// out and flow through the same oracle. Their expected bucket is snapshot-recorded,
// never hard-asserted, so a future fix that rescues one is a benign snapshot diff.
export const SEED_CASES: OracleCase[] = [
  {
    // Cliff round-down ripple. The grant sits 12 months before the lump, so the
    // 12-month hold reads as a cliff. The 48-over-3 tail then ripples (75 over 12
    // ⇒ 6,6,6,7,…).
    id: "seed-0-cliff-ripple",
    dsl: "100 VEST OVER 48 months EVERY 3 months CLIFF 12 months",
    grantDate: "2023-01-01",
    total: 100,
    dom: "VESTING_START_DAY",
    params: {
      kind: "seed",
      seed: "cliff-ripple",
      note: "48-over-3 with a 12mo cliff; grant 12mo before the lump; ripple tail",
    },
    slices: [],
    v1Comparable: false,
  },
  {
    // Isolated singles — the 137/891/42 shape. Each `OVER 1 months EVERY 1 month`
    // segment is one installment spanning one month, so the THEN tail starts a
    // month after the previous lump and the three lumps land on DISTINCT dates
    // (2024-02/03/04-01). That's why this is a real `template` of distinct
    // installments and not a one-date collapse — the feared "THEN tail inherits
    // the prior end" only bites a zero-span segment.
    id: "seed-1-isolated-singles",
    dsl: "137 VEST OVER 1 months EVERY 1 month THEN 891 VEST OVER 1 months EVERY 1 month THEN 42 VEST OVER 1 months EVERY 1 month",
    grantDate: "2024-01-01",
    total: 1070,
    dom: "VESTING_START_DAY",
    params: {
      kind: "seed",
      seed: "isolated-singles",
      note: "137/891/42 as a THEN chain of one-month singles on distinct dates",
    },
    slices: [],
    v1Comparable: false,
  },
];

// Named clean cases the test hard-asserts land in the clean bucket, INDEPENDENT
// of the snapshot — so a case sliding clean → broken fails even under
// `vitest -u`. Kept non-empty by the test so the tripwire can't be neutered.
export const CLEAN_TRIPWIRE_CASES: OracleCase[] = [
  {
    // The canonical positive control: a plain uniform monthly grid round-trips to
    // an identical one-statement template.
    id: "clean-uniform-4mo",
    dsl: "100 VEST OVER 4 months EVERY 1 month",
    grantDate: "2024-01-01",
    total: 100,
    dom: "VESTING_START_DAY",
    params: {
      kind: "seed",
      seed: "clean-uniform-4mo",
      note: "plain 4-month uniform grid; identical template both sides",
    },
    slices: [],
    v1Comparable: false,
  },
  {
    // A second uniform, quarterly over a year, with a dividing total — still one
    // clean template.
    id: "clean-uniform-quarterly",
    dsl: "96 VEST OVER 12 months EVERY 3 months",
    grantDate: "2024-01-01",
    total: 96,
    dom: "VESTING_START_DAY",
    params: {
      kind: "seed",
      seed: "clean-uniform-quarterly",
      note: "quarterly-over-a-year uniform grid; dividing total",
    },
    slices: [],
    v1Comparable: false,
  },
  {
    // MINUS_ONE round-trip control (#503): a day-31 start under
    // VESTING_START_DAY_MINUS_ONE produces a month-end-minus-one pattern
    // (2024-02-28, 2024-03-30, 2024-04-29, …) that no VESTING_START_DAY seed
    // reproduces, so a clean recovery MUST land on MINUS_ONE. Hard-asserted clean
    // to keep the MINUS_ONE search wired.
    id: "clean-minus-one-day31",
    dsl: "100 VEST OVER 12 months EVERY 1 months",
    grantDate: "2024-01-31",
    total: 100,
    dom: "VESTING_START_DAY_MINUS_ONE",
    params: {
      kind: "seed",
      seed: "clean-minus-one-day31",
      note: "day-31 start under MINUS_ONE; month-end-minus-one pattern only MINUS_ONE reproduces",
    },
    slices: [],
    v1Comparable: false,
  },
];

// A stacked-cover stream (a 2-statement PLUS superposition that infer emits as a
// 3-statement cover). Un-mixing a stacked cover is non-unique by construction, so
// this is recorded as a deliberately-excluded breadcrumb and never run through
// the asserted oracle.
export const EXCLUDED_SEEDS = [
  {
    id: "excluded-0-stacked-cover",
    tranches: [5, 2, 1, 2, 2],
    why: "un-mixing a stacked PLUS cover is non-unique by construction; deliberately out of scope",
  },
];
