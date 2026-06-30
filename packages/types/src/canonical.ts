// Canonical vesting IR — the Carta-aligned interchange. The interchange half is
// no longer hand-authored here: it *is* the OCF v2-alpha vesting shape, re-exposed
// under the same names `@vestlang/core` and the rest of the repo already import.
// OCF/Carta data flows straight in with no adaptation, and the snake_case wire
// fields (`period_type`, `event_id`) are the OCF declarations themselves rather
// than a parallel copy that could drift.
//
// The runtime layer below (`RuntimeBase` and friends) stays vestlang-local: it is
// the firing-bearing per-grant state the engine substitutes into a template, which
// the interchange deliberately doesn't carry.

import type { OCTDate } from "./helpers.js";
import type { VestingDayOfMonth } from "./oct_types.js";
import type {
  OCFScheduledVestingStatement,
  OCFMilestoneVestingStatement,
} from "@opencaptablecoalition/ocf-types";

// The interchange types are re-exported straight from the vendored OCF v2
// declarations, so they *are* the OCF shape rather than a parallel copy that could
// drift:
//   - OCFPeriodType             the DAYS/MONTHS/YEARS unit (includes YEARS, unlike
//                               the DSL's own PeriodTag, which writes a year as 12
//                               months);
//   - OCFVestingScheduleSegment a statement's time grid (occurrences/period/
//                               period_type, an optional cliff, and the optional
//                               vesting_day_of_month policy);
//   - OCFVestingScheduleCliff   a duration cliff carved out of that grid;
//   - OCFVestingTermsV2         the template: an id, the `VESTING_TERMS` object_type
//                               tag, and an ordered statement list.
export type {
  OCFPeriodType,
  OCFVestingScheduleSegment,
  OCFVestingScheduleCliff,
  OCFVestingTermsV2,
} from "@opencaptablecoalition/ocf-types";

// OCF inlines the statement union inside OCFVestingTermsV2 and exports no standalone
// name for it, so vestlang names it locally. A scheduled statement carries a
// `schedule` (and may also carry an `event_condition`); a pure milestone carries an
// `event_condition` and omits `schedule` entirely. The milestone arm having no
// `schedule` key — rather than `schedule?: never` — is why reads of `.schedule` must
// narrow on its presence first.
export type OCFVestingStatement =
  | OCFScheduledVestingStatement
  | OCFMilestoneVestingStatement;

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

// The firing-free part of the per-grant runtime the engine substitutes into a
// template:
//   - startDate    — the hoisted vesting start; the DATE cursor's origin.
//   - grantDate    — when provided, scheduled amounts dated before grantDate are
//                    held back and emitted as a single aggregate on grantDate
//                    (an implicit cliff at grant date).
//   - vestingDayOfMonth — additive-optional convention field; omitted ⇒ the
//                    canonical default (VESTING_START_DAY).
//                    Allocation is always CUMULATIVE_ROUND_DOWN — the interchange
//                    has no allocation field.
export interface RuntimeBase {
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

// The single source of truth for the `RuntimeBase` field names. The downstream
// sites that re-list these — the `toStoredTerms` projection, the producer in
// lower.ts, the MCP wire validator — all derive from this set, so a new field
// can't be silently dropped on the way to storage (#417/#422).
//
// Object-keyed, not an array, on purpose: only `satisfies Record<keyof
// RuntimeBase, true>` forces the set to name *every* key (a missing one is a
// compile error). An array `satisfies readonly (keyof RuntimeBase)[]` would catch
// a stray key but happily accept a subset, so it could never catch a dropped one.
export const RUNTIME_BASE_KEYS = {
  startDate: true,
  grantDate: true,
  vestingDayOfMonth: true,
} satisfies Record<keyof RuntimeBase, true>;

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
