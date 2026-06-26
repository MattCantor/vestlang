// Deterministic generator for the round-trip oracle (issue #489).
//
// Enumerates single-schedule DSL templates over an explicit parameter grid — no
// fast-check, no randomness — plus a handful of hand-pinned seeds. Every case is
// a DSL string the oracle runs through `parse → normalizeProgram →
// evaluateProgram`, so the value lives entirely in the shape parameters below;
// the actual evaluate/infer/re-evaluate round trip and the bucketing are the
// test's job (roundtripOracle.test.ts).
//
// The grid is cliff-dense on purpose: the inversion gap this characterizes is a
// cliff (or a chain of distinct lumps) that should round-trip to one reusable
// canonical template but comes back as a flat events-only list. Widening the
// search = adding values to an axis here, nothing else.

import type { OCTDate, VestingDayOfMonth } from "@vestlang/types";

/** Where the grant date sits relative to the schedule's vesting start. Local —
 *  consumers read the offset off `CaseParams`/`AXES`, never by this name. */
type OffsetMode = "fromGrant" | "backdated";

/** The shape parameters recorded for each snapshot entry. A grid point carries
 *  its six axis values; a hand-pinned seed carries a name + note instead, since
 *  a THEN chain or an off-grid cliff doesn't decompose into the same axes. */
export type CaseParams =
  | {
      kind: "grid";
      offset: OffsetMode;
      total: number;
      duration: number;
      cadence: number;
      cliff: number | null; // months; null = no cliff
      dom: VestingDayOfMonth;
    }
  | { kind: "seed"; seed: string; note: string };

export interface OracleCase {
  /** Stable, zero-padded id so the snapshot sorts numerically under a plain
   *  lexicographic compare and never churns. */
  id: string;
  dsl: string;
  /** The grant date the template is evaluated under — handed to `inferSchedule`
   *  so a cliff is recoverable as a cliff (Decision 3). */
  grantDate: OCTDate;
  /** Grant quantity for the evaluation; also the `<total>` in the DSL. */
  total: number;
  /** The original eval's day-of-month axis value. The recovered eval re-derives
   *  its own (infer searches it), so this is the *original* convention only. */
  dom: VestingDayOfMonth;
  params: CaseParams;
}

// v1 axis values. Coverage is asserted per VALUE in the test, so dropping one
// here fails loudly rather than silently shrinking the search.
export const AXES = {
  // grant/start offset: realized through grantDate, not the DSL.
  offset: ["fromGrant", "backdated"] satisfies OffsetMode[],
  // short and long; both divisible by every cadence so the grid admits cleanly.
  duration: [12, 48],
  cadence: [1, 3, 6, 12],
  // none, plus two duration cliffs whose lump leaves a non-dividing tail (the
  // round-down ripple) on most totals.
  cliff: [null, 6, 12] as (number | null)[],
  // a cleanly-dividing total (96) beside two that ripple (100, 1000).
  total: [96, 100, 1000],
  // day 1, mid-month, and the month-end policy.
  dom: ["01", "15", "31_OR_LAST_DAY_OF_MONTH"] satisfies VestingDayOfMonth[],
};

// The schedule's vesting start in the DSL, fixed across the grid. For
// `fromGrant` the start is left implicit (= grant date); for `backdated` it's
// written explicitly and the grant date is pushed past it (below) so the early
// installments fold onto the grant date — the inferrer's pre-grant-fold path.
const START_DATE = "2024-01-01";

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function gridId(p: Extract<CaseParams, { kind: "grid" }>): string {
  const cliff = p.cliff === null ? "none" : pad(p.cliff, 2);
  return [
    `off-${p.offset === "fromGrant" ? "0grant" : "1backd"}`,
    `dur-${pad(p.duration, 2)}`,
    `cad-${pad(p.cadence, 2)}`,
    `cliff-${cliff}`,
    `tot-${pad(p.total, 5)}`,
    `dom-${p.dom}`,
  ].join("__");
}

function buildDsl(
  offset: OffsetMode,
  total: number,
  duration: number,
  cadence: number,
  cliff: number | null,
): string {
  const from = offset === "backdated" ? `FROM DATE ${START_DATE} ` : "";
  const cl = cliff === null ? "" : ` CLIFF ${cliff} months`;
  return `${total} VEST ${from}OVER ${duration} months EVERY ${cadence} months${cl}`;
}

/** Grant date for each offset mode: at the start, or six months after it (so the
 *  pre-grant installments fold onto the grant date). */
function grantDateFor(offset: OffsetMode): OCTDate {
  return offset === "backdated" ? "2024-07-01" : START_DATE;
}

/** The full grid, in a fixed nested-loop order. Pruning (admit only
 *  template-status, all-RESOLVED) happens in the test, not here — a grid point
 *  that fails to parse or evaluate is dropped there. */
export function gridCases(): OracleCase[] {
  const cases: OracleCase[] = [];
  for (const offset of AXES.offset)
    for (const duration of AXES.duration)
      for (const cadence of AXES.cadence)
        for (const cliff of AXES.cliff)
          for (const total of AXES.total)
            for (const dom of AXES.dom) {
              const params = {
                kind: "grid" as const,
                offset,
                total,
                duration,
                cadence,
                cliff,
                dom,
              };
              cases.push({
                id: gridId(params),
                dsl: buildDsl(offset, total, duration, cadence, cliff),
                grantDate: grantDateFor(offset),
                total,
                dom,
                params,
              });
            }
  return cases;
}

// Hand-pinned seeds the issue calls out by name. These are NOT parametric grid
// points — a THEN chain and an off-grid grant date don't fit the six axes — so
// they're spelled out and flow through the same oracle. Their expected bucket is
// snapshot-recorded, never hard-asserted, so a future fix that rescues one is a
// benign snapshot diff (AC4).
export const SEED_CASES: OracleCase[] = [
  {
    // Cliff round-down ripple. The grant sits 12 months before the lump, so the
    // 12-month hold reads as a cliff. The 48-over-3 tail then ripples (75 over 12
    // ⇒ 6,6,6,7,…). Expected today: structural failure (recovers as a PLUS, which
    // re-evaluates events-only).
    id: "seed-0-cliff-ripple",
    dsl: "100 VEST OVER 48 months EVERY 3 months CLIFF 12 months",
    grantDate: "2023-01-01",
    total: 100,
    dom: "01",
    params: {
      kind: "seed",
      seed: "cliff-ripple",
      note: "48-over-3 with a 12mo cliff; grant 12mo before the lump; ripple tail",
    },
  },
  {
    // Isolated singles — the 137/891/42 shape. Each `OVER 1 months EVERY 1 month`
    // segment is one installment spanning one month, so the THEN tail starts a
    // month after the previous lump and the three lumps land on DISTINCT dates
    // (2024-02/03/04-01). That's why this is a real `template` of distinct
    // installments and not a one-date collapse — the feared "THEN tail inherits
    // the prior end" only bites a zero-span segment. Expected today: structural
    // failure (recovers as a 3-way PLUS).
    id: "seed-1-isolated-singles",
    dsl: "137 VEST OVER 1 months EVERY 1 month THEN 891 VEST OVER 1 months EVERY 1 month THEN 42 VEST OVER 1 months EVERY 1 month",
    grantDate: "2024-01-01",
    total: 1070,
    dom: "01",
    params: {
      kind: "seed",
      seed: "isolated-singles",
      note: "137/891/42 as a THEN chain of one-month singles on distinct dates",
    },
  },
];

// Named clean cases the test hard-asserts land in the clean bucket, INDEPENDENT
// of the snapshot (AC6) — so a case sliding clean → broken fails even under
// `vitest -u`. Kept non-empty by the test so the tripwire can't be neutered.
export const CLEAN_TRIPWIRE_CASES: OracleCase[] = [
  {
    // The canonical positive control: a plain uniform monthly grid round-trips to
    // an identical one-statement template.
    id: "clean-uniform-4mo",
    dsl: "100 VEST OVER 4 months EVERY 1 month",
    grantDate: "2024-01-01",
    total: 100,
    dom: "01",
    params: {
      kind: "seed",
      seed: "clean-uniform-4mo",
      note: "plain 4-month uniform grid; identical template both sides",
    },
  },
  {
    // A second uniform, quarterly over a year, with a dividing total — still one
    // clean template.
    id: "clean-uniform-quarterly",
    dsl: "96 VEST OVER 12 months EVERY 3 months",
    grantDate: "2024-01-01",
    total: 96,
    dom: "01",
    params: {
      kind: "seed",
      seed: "clean-uniform-quarterly",
      note: "quarterly-over-a-year uniform grid; dividing total",
    },
  },
];

// The `[5,2,1,2,2]` stacked-cover stream from the issue: a 2-statement PLUS
// superposition that infer emits as a 3-statement cover. Un-mixing a stacked
// cover is non-unique by construction (Non-goals), so this is recorded as a
// deliberately-excluded breadcrumb for a future fix-issue and never run through
// the asserted oracle.
export const EXCLUDED_SEEDS = [
  {
    id: "excluded-0-stacked-cover",
    tranches: [5, 2, 1, 2, 2],
    why: "stacked PLUS-superposed cover; un-mixing is non-unique, out of scope (Non-goals)",
  },
];
