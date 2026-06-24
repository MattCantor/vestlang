// Canonical vesting IR — the Carta-aligned interchange. The single shared home
// for these types; `@vestlang/core` imports them back (type-only).
//
// The template shape is the *interchange*: OCF/Carta data flows straight in,
// with no adaptation. So the field names stay snake_case (`period_type`,
// `event_id`) to match the canonical wire form exactly —
// any divergence would force the OCF↔core bridge `@vestlang/core` exists to
// delete.

import type { Numeric, OCTDate } from "./helpers.js";
import type { VestingDayOfMonth } from "./oct_types.js";

// From enums/PeriodType.schema.json
// The OCF/Carta interchange period unit, which includes YEARS. Distinct from the
// DSL's own `PeriodTag` (./enums.ts), which omits YEARS: vestlang source writes a
// year as 12 months. The difference is intentional, not an oversight.
export type PeriodType = "DAYS" | "MONTHS" | "YEARS";

export interface VestingScheduleTemplate {
  id: string;
  statements: VestingStatement[]; // chained implicitly by order (DATE statements only)
}

// The time grid of a vesting statement — the periodic installments and an
// optional cliff carved out of them. Optional on the statement: a *pure
// milestone* (a slice that vests purely on an `event_condition`, with no time
// schedule) omits this block entirely, so "no schedule" reads as absence rather
// than as a degenerate one-installment grid. A `cliff` lives *inside* the
// schedule because a cliff carves a grid — with no grid there is nothing to
// carve — so a cliff never floats free of a schedule.
export interface VestingSchedule {
  occurrences: number; // integer >= 1; number of vesting events in segment
  period: number; // integer >= 0; length of one installment, in period_type units
  period_type: PeriodType;
  cliff?: Cliff;
}

// A canonical vesting statement: `order` and `percentage` always; then exactly one
// of two shapes. A *scheduled* statement carries a `schedule` (DATE or HYBRID) and
// may also carry an `event_condition`; a *pure milestone* carries an
// `event_condition` and no `schedule`. The union makes the neither-corner — neither
// a schedule nor an event_condition — unrepresentable rather than merely
// validator-caught.
export type VestingStatement = {
  order: number; // 1-based sequence position
  // Share of the total grant this vesting statement covers, stored as an OCF
  // `Numeric` decimal string (the interchange holds a fixed-point decimal, not a
  // rational). The engine parses it back to an exact Fraction at every read.
  percentage: Numeric;
} & (
  | {
      // The time grid (with its optional cliff). Present on DATE and HYBRID
      // statements; a scheduled statement may also carry an `event_condition`.
      schedule: VestingSchedule;
      // An event that must fire before this statement's grid releases. This is how
      // an event-held cliff (`CLIFF EVENT ipo`, `CLIFF LATER OF(12 months, EVENT
      // ipo)`) stores: the time baseline, if any, lands in `schedule.cliff`, and the
      // event hold lands here. It tracks Carta's HYBRID tranche — a dated schedule
      // carrying an EVENT_NON_MARKET performanceCondition. The `event_id` names the
      // gating event: a real user event for a bare `CLIFF EVENT e`, or a reserved
      // synthetic `evt:<n>` whose recipe lives in the sidecar when the event side is
      // richer than a single bare id (multiple events, an offset, a gate). Until the
      // event fires the whole grid is held; once it does, the projection folds at
      // max(schedule.cliff date, firing).
      event_condition?: { event_id: string };
    }
  | {
      // A pure milestone: no time schedule, so the slice vests entirely on the
      // event hold. `schedule?: never` forbids a stray schedule on this arm.
      schedule?: never;
      event_condition: { event_id: string };
    }
);

// Anchoring is implicit: every statement takes its start from the one per-grant
// date hoisted to VestingRuntime.startDate, chained by `order`. The canonical
// template carries no per-statement anchor. A contingent start (the calendar date
// isn't known until a named event fires) is no exception — its startDate is the
// far-future CONTINGENT_START_SENTINEL, and the contingency itself lives
// out-of-band in a reserved `evt:start` sidecar entry that vestlang re-derives on
// reload (see packages/evaluator/src/resolve/rehydrate.ts). Carta — the ingestion
// target — has exactly one date-typed vestingStartDate per grant and no
// event-typed vesting start, which is why the anchor is always that one date.

export interface Fraction {
  numerator: number; // integer
  denominator: number; // integer >= 1
}

export interface Cliff {
  // Time-based, matching Carta's VestingPeriod cliff (cliffLength/cliffLengthUnit/
  // cliffPercentage). The cliff date is `length` `period_type`s after the
  // statement's anchor; `percentage` of the statement vests there as a lump.
  // A duration (not an occurrence index), so it handles cliffs that don't land
  // on an installment boundary.
  length: number; // duration until the cliff, in period_type units (integer >= 0)
  period_type: PeriodType; // unit of `length`
  // Share of the statement that vests at the cliff, stored as an OCF `Numeric`
  // decimal string (parsed to a Fraction at every read). A repeating share like
  // a 1/3 cliff can only be written truncated here — the precision guard flags
  // when that truncation misallocates at the grant size in play.
  percentage: Numeric;
}

// The firing-free part of the per-grant runtime the engine substitutes into a
// template:
//   - startDate    — the hoisted vesting start; the DATE cursor's origin.
//   - grantDate    — when provided, scheduled amounts dated before grantDate are
//                    held back and emitted as a single aggregate on grantDate
//                    (an implicit cliff at grant date).
//   - vestingDayOfMonth — additive-optional convention field; omitted ⇒ the
//                    canonical default (VESTING_START_DAY_OR_LAST_DAY_OF_MONTH).
//                    Allocation is always CUMULATIVE_ROUND_DOWN — the interchange
//                    has no allocation field.
interface RuntimeBase {
  // The hoisted vesting start; the DATE cursor's origin. A contingent start (its
  // calendar date unknown until a named event fires) stores the far-future
  // CONTINGENT_START_SENTINEL (`9999-12-31`, in @vestlang/utils) here, with the
  // recipe to re-derive the real date held in a reserved `evt:start` sidecar
  // entry. The sentinel is storage-only — the compiler recognizes it and emits no
  // dated tranches rather than gridding off it (a real run past year 9999
  // overflows the date math).
  startDate?: OCTDate;
  grantDate?: OCTDate;
  vestingDayOfMonth?: VestingDayOfMonth;
}

// One named-event firing — the runtime witness channel for an event hold. The
// start path no longer uses it (a contingent start is a DATE base on the sentinel
// + an `evt:start` recipe), but a statement's `event_condition` does: in
// resolution mode the engine records the resolved condition firing here, keyed by
// the condition's `event_id` (a real id or a synthetic `evt:<n>`), and `compile`
// reads it to place the cliff fold at max(cliff date, firing). The interchange
// (firing-blind) build leaves it unset, so the hold projects nothing. Firing-
// invariance is type-enforced below: a stored artifact can carry no firings, so
// they are re-derived from the world on every reload (see resolve/rehydrate.ts),
// never baked in.
interface EventFiring {
  event_id: string;
  date: OCTDate;
}

// What a *stored* artifact's runtime holds. A persisted artifact is firing-
// invariant by construction (the interchange is firing-blind), so it can carry no
// witnesses — and `eventFirings?: never` makes that unrepresentable at the type
// level, not merely an empty array a future edit could populate. Witnesses are
// re-derived from the world on every reload (see resolve/rehydrate.ts), never
// baked in.
export interface StoredTerms extends RuntimeBase {
  eventFirings?: never;
}

// The firings-carrying runtime: evaluated/rehydrated state. Keeps the original
// name so the compile/validate/resolve consumers that substitute it into a
// template need no edits.
export interface VestingRuntime extends RuntimeBase {
  eventFirings?: EventFiring[];
}
