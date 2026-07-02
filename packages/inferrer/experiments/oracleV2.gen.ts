// v2 widened grid for the round-trip oracle — attacks the v1 grid's harmonic
// degeneracy (every cadence divided every duration, every cliff sat on a cadence
// boundary, every start was day-1, MINUS_ONE was absent, no off-grid grant).
//
// Deterministic, no randomness. Structured as a moderate CORE CROSS (axis
// interactions) plus PROBE SLICES (one axis swept richly, the others pinned at
// v1 defaults). Ids are pure functions of the axis tuple, so a point reached by
// several slices dedupes to one case that remembers its slice memberships.
//
// Points that fail parse/eval or evaluate non-template / non-all-RESOLVED are
// NOT filtered here — the sweep runner prunes them and reports the reason
// distribution (cliff > duration, for instance, is itself a datum: does it
// prune or degenerate?).

import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";

export type OffsetV2 = "fromGrant" | "backdated" | "offGridBackdated";

export interface V2Params {
  offset: OffsetV2;
  /** The schedule's vesting start (v1 pinned this to 2024-01-01). */
  startDate: OCTDate;
  duration: number;
  cadence: number;
  cliff: number | null;
  total: number;
  dom: VestingDayOfMonth;
}

export interface V2Case {
  id: string;
  dsl: string;
  grantDate: OCTDate;
  total: number;
  dom: VestingDayOfMonth;
  params: V2Params;
  /** Which probe slices / cross generated this tuple (dedup-merged). */
  slices: string[];
  /** Inside the v1 grid's axis ranges — the apples-to-apples subspace. */
  v1Comparable: boolean;
}

// v1 defaults every probe slice pins unless it is the axis under sweep.
export const V1_DEFAULTS = {
  offset: "fromGrant" as OffsetV2,
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
  return `${ty}-${pad(tm + 1, 2)}-${pad(Math.min(d, daysInTarget), 2)}` as OCTDate;
}

function addDays(iso: OCTDate, days: number): OCTDate {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days))
    .toISOString()
    .slice(0, 10) as OCTDate;
}

/** Grant date per offset mode. `backdated` matches v1's construction (start + 6
 *  months, so early installments fold onto the grant date). `offGridBackdated`
 *  pushes 14 further days so the grant falls STRICTLY BETWEEN two installment
 *  dates (start 2024-01-01 → grant 2024-07-15). */
export function grantDateFor(offset: OffsetV2, start: OCTDate): OCTDate {
  if (offset === "fromGrant") return start;
  const backdated = addMonthsClamped(start, 6);
  return offset === "backdated" ? backdated : addDays(backdated, 14);
}

// ---- id / dsl ---------------------------------------------------------------

const OFFSET_TAG: Record<OffsetV2, string> = {
  fromGrant: "0grant",
  backdated: "1backd",
  offGridBackdated: "2offgd",
};

export function v2Id(p: V2Params): string {
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

function buildDsl(p: V2Params): string {
  const from = p.offset === "fromGrant" ? "" : `FROM DATE ${p.startDate} `;
  const cl = p.cliff === null ? "" : ` CLIFF ${p.cliff} months`;
  return `${p.total} VEST ${from}OVER ${p.duration} months EVERY ${p.cadence} months${cl}`;
}

// ---- v1-comparability -------------------------------------------------------

const V1_DURATIONS = new Set([12, 48]);
const V1_CADENCES = new Set([1, 3, 6, 12]);
const V1_CLIFFS = new Set<number | null>([null, 6, 12]);
const V1_TOTALS = new Set([96, 100, 1000]);
const V1_DOMS = new Set<VestingDayOfMonth>([
  "VESTING_START_DAY",
  "FIRST_DAY_OF_MONTH",
  "LAST_DAY_OF_MONTH",
]);

function isV1Comparable(p: V2Params): boolean {
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

// ---- slice machinery ---------------------------------------------------------

type Slice = { tag: string; points: V2Params[] };

function cross(
  tag: string,
  axes: {
    offset: OffsetV2[];
    startDate: OCTDate[];
    pairs: [number, number][]; // [duration, cadence], duration % cadence === 0
    cliff: (number | null)[];
    total: number[];
    dom: VestingDayOfMonth[];
  },
): Slice {
  const points: V2Params[] = [];
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

const D = V1_DEFAULTS;

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
        pairs: ([2, 3, 6] as const).map((c) => [duration, c] as [number, number]),
        cliff: cliffs,
        total: [96, 100],
        dom: [D.dom],
      }),
    );
  }
  return out;
}

// S2 — duration/cadence pairs beyond {12,48}×{1,3,6,12}: prime durations,
// non-divisor-rich pairs, and the single-occurrence degenerate (12,12).
const DURCAD_PAIRS: [number, number][] = [
  [12, 1],
  [12, 3],
  [48, 12], // v1 controls
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

// S3 — totals: v1 controls plus a prime (97), a chain-of-lumps total (1070),
// and sub-occurrence totals (10, 5) that force zero-amount installments on the
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
// crossed with ALL FOUR policies, incl. the inferrer's deliberate MINUS_ONE
// search exclusion (#503). Month-end starts exercise short-month clamping.
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
// beside the v1 modes, on short and long grids.
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

/** The deduped v2 grid, in first-seen slice order (deterministic). */
export function v2Cases(): V2Case[] {
  const slices: Slice[] = [
    ...cliffProbe(),
    durcadProbe(),
    totalProbe(),
    domStartProbe(),
    offsetProbe(),
    coreCross(),
  ];
  const byId = new Map<string, V2Case>();
  for (const { tag, points } of slices) {
    for (const params of points) {
      const id = v2Id(params);
      const existing = byId.get(id);
      if (existing) {
        if (!existing.slices.includes(tag)) existing.slices.push(tag);
        continue;
      }
      byId.set(id, {
        id,
        dsl: buildDsl(params),
        grantDate: grantDateFor(params.offset, params.startDate),
        total: params.total,
        dom: params.dom,
        params,
        slices: [tag],
        v1Comparable: isV1Comparable(params),
      });
    }
  }
  return [...byId.values()];
}
