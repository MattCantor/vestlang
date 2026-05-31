// Canonical vesting IR — the Carta-aligned interchange. The single shared home
// for these types; `@vestlang/core` imports them back (type-only).
//
// Ported from OCF-Tools' canonical vesting types
// (~/code/OCF-Tools/types/canonical/vesting/types.ts), which themselves track
// OCF-Composed-Schemas:
// https://github.com/Open-Cap-Table-Coalition/OCF-Composed-Schemas/blob/main/canonical/vesting/types.ts
//
// The template shape is the *interchange*: OCF/Carta data flows straight in,
// with no adaptation. So the field names stay snake_case (`vesting_base`,
// `period_type`, `event_id`, `realized_fraction`) to match the canonical wire
// form exactly — any divergence would force the OCF↔core bridge `@vestlang/core`
// exists to delete.

import type { OCTDate } from "./helpers.js";
import type { AllocationType, VestingDayOfMonth } from "./oct_types.js";

// From enums/PeriodType.schema.json
export type PeriodType = "DAYS" | "MONTHS" | "YEARS";

export interface VestingScheduleTemplate {
  id: string;
  statements: VestingStatement[]; // chained implicitly by order (DATE statements only)
}

export interface VestingStatement {
  order: number; // 1-based sequence position
  vesting_base: TemplateVestingBase; // anchor: per-grant date (DATE) or named event (EVENT)
  occurrences: number; // integer >= 1; number of vesting events in segment
  period: number; // integer >= 0; length of one installment, in period_type units
  period_type: PeriodType;
  cliff?: Cliff;
  percentage: Fraction; // share of total grant this vesting statement covers
}

// Discriminated union for how a VestingStatement's schedule is anchored.
// DATE-anchored statements take their start from a per-grant date supplied
// out-of-band (via VestingRuntime.startDate). EVENT-anchored statements anchor
// to the firing date of a named event (via VestingRuntime.eventFirings). The
// event's definition (what it means, how it's achieved) is not modeled here;
// the consumer maintains that out-of-band. Multiple statements may reference the
// same event_id — a single firing fans out to all matching statements.
//
// Named `Template*` to distinguish it from the DSL/AST `VestingBase` family
// (`./ast.ts`), which preserves a syntactic `value: string` rather than this
// semantic `event_id`.
export type TemplateVestingBase =
  | TemplateVestingBaseDate
  | TemplateVestingBaseEvent;

export interface TemplateVestingBaseDate {
  type: "DATE";
}

export interface TemplateVestingBaseEvent {
  type: "EVENT";
  event_id: string;
}

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
  percentage: Fraction; // share of the statement that vests at the cliff
}

// Per-grant runtime data the engine substitutes into a template:
//   - startDate    — the hoisted vesting start; the DATE cursor's origin.
//   - eventFirings — zero or more named-event firings. A single firing fans out
//                    to every EVENT statement sharing its event_id. The optional
//                    realized_fraction scales that firing's contribution.
//   - grantDate    — when provided, scheduled amounts dated before grantDate are
//                    held back and emitted as a single aggregate on grantDate
//                    (an implicit cliff at grant date).
//   - vestingDayOfMonth / allocationType — additive-optional convention fields;
//                    omitted ⇒ the canonical defaults (allocation →
//                    CUMULATIVE_ROUND_DOWN; day-of-month →
//                    VESTING_START_DAY_OR_LAST_DAY_OF_MONTH).
export interface VestingRuntime {
  startDate?: OCTDate;
  eventFirings?: Array<{
    event_id: string;
    date: OCTDate;
    realized_fraction?: Fraction;
  }>;
  grantDate?: OCTDate;
  vestingDayOfMonth?: VestingDayOfMonth;
  allocationType?: AllocationType;
}
