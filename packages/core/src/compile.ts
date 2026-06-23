// The canonical compile: a template, a per-grant runtime, and a total share
// count become exact integer installments.
//
// The engine is vestlang's own. The allocator, date math, and fold are all
// vestlang primitives; this file adds the orchestration that walks the canonical
// IR, with the cliff applied by date rather than by occurrence index (see
// expandAnchored).
//
// One engine, two output shapes:
//   compile(...)             -> { date, amount: string }[]  (OCF/Carta-native)
//   compileToInstallments(…) -> { date, amount: number }[]  (consumed by extended)

import type {
  OCTDate,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/types";
import {
  addPeriod,
  advanceCursor,
  allocateEvents,
  CONTINGENT_START_SENTINEL,
  expandGrid,
  type GridCliff,
  type RawEvent,
} from "@vestlang/primitives";
import { numericToFraction } from "@vestlang/utils";
import {
  assertValidVestingRuntime,
  assertValidVestingScheduleTemplate,
} from "./validate";

/** OCF/Carta-native vesting event — amount as a decimal string. */
export interface CompiledEvent {
  date: OCTDate;
  amount: string;
}

/** Numeric installment — for extended's downstream rendering. */
export interface CompiledInstallment {
  date: OCTDate;
  amount: number;
}

// The later of two dates. OCTDate is ISO YYYY-MM-DD, so lexical order is calendar
// order. The fold point of an event-held cliff is max(time baseline date, firing).
const laterOf = (a: OCTDate, b: OCTDate): OCTDate => (a > b ? a : b);

/**
 * Lower one statement onto the shared grid kernel. The cliff is a duration from
 * the anchor (so the lump lands on its true date, off-grid or not). `origin`
 * carries the chain's first date, the grant's single vesting day that every MONTHS
 * grid anchors to; it defaults to `anchor`.
 *
 * An event hold (`event_condition`) overrides the time cliff's lump: while the
 * condition's event hasn't fired the whole grid is held (this returns no events);
 * once it fires the grid folds at max(time baseline date, firing) as ONE
 * proportional cliff — the lump takes whatever share of the grid accrued by then.
 * The stored time `cliff`'s percentage is the Carta-facing baseline and is not
 * applied as its own lump; only its date contributes (the floor in the max).
 */
const expandAnchored = (
  statement: VestingStatement,
  anchor: OCTDate,
  dom: VestingRuntime["vestingDayOfMonth"],
  firingFor: (eventId: string) => OCTDate | undefined,
  origin: OCTDate = anchor,
): RawEvent[] => {
  // Narrow once on `schedule` presence. A pure milestone carries no time grid in
  // storage, so the kernel folds it on the degenerate one-lump params — a single
  // installment at `anchor + 0` (the `period_type` is inert at `period: 0`, so its
  // value is arbitrary but must be supplied). A scheduled statement reads its grid
  // and cliff straight off `statement.schedule`.
  const schedule = statement.schedule;
  const grid = schedule ?? { occurrences: 1, period: 0, period_type: "DAYS" };
  const cliffSpec = schedule?.cliff;

  // The time baseline date, when the statement carries a time cliff.
  const baselineDate = cliffSpec
    ? addPeriod(anchor, cliffSpec.length, cliffSpec.period_type, dom)
    : undefined;

  let cliff: GridCliff;
  if (statement.event_condition) {
    const firing = firingFor(statement.event_condition.event_id);
    if (firing === undefined) {
      // Held: the event hasn't fired, so the whole grid waits on it. Emit nothing.
      // A pure milestone always takes this path while unfired (it projects nothing
      // until the event arrives).
      return [];
    }
    // Fired: one proportional cliff at max(baseline, firing). The baseline date (if
    // any) is only a floor; the lump's size is the accrued share, not the stored
    // percentage.
    cliff = {
      kind: "proportional",
      date: baselineDate !== undefined ? laterOf(baselineDate, firing) : firing,
    };
  } else if (cliffSpec && baselineDate !== undefined) {
    cliff = {
      kind: "fixed",
      date: baselineDate,
      // Stored as a Numeric decimal; the kernel works in exact rational.
      percentage: numericToFraction(cliffSpec.percentage),
    };
  } else {
    cliff = { kind: "none" };
  }

  return expandGrid({
    anchor,
    origin,
    period: grid.period,
    periodType: grid.period_type,
    occurrences: grid.occurrences,
    stmtFraction: numericToFraction(statement.percentage),
    statementOrder: statement.order,
    dom,
    cliff,
  });
};

/**
 * Expand one statement into raw events.
 *
 * Every statement is DATE-anchored: events anchor at `dateCursor`, and the cursor
 * advances by the full statement duration (occurrences × period), so statement
 * N+1 chains off where N ended (the 5/15/40/40 graded semantic).
 *
 * Sentinel-skip: when the hoisted start is CONTINGENT_START_SENTINEL the real
 * date isn't known (a persisted contingent start whose event hasn't been
 * re-resolved), so the statement emits NO dated tranches (returns null) and the
 * cursor doesn't advance. This is a pure projection guard reading the sentinel
 * VALUE — it never reaches the date grid, where a real run off year 9999 would
 * overflow `addPeriod`/`advanceCursor`. A resolved contingent start reaches here
 * with a real date instead: rehydrate substitutes the re-derived date into a
 * projection-only runtime, so the sentinel is gone by then.
 */
const expandStatement = (
  statement: VestingStatement,
  runtime: VestingRuntime,
  dateCursor: OCTDate | undefined,
  firingFor: (eventId: string) => OCTDate | undefined,
): { events: RawEvent[]; nextCursor: OCTDate | undefined } | null => {
  const dom = runtime.vestingDayOfMonth;

  // An unresolved contingent placeholder: skip it. (Pure projection guard reading
  // the sentinel value — see CONTINGENT_START_SENTINEL. Distinct from the
  // rehydrate override decision, which keys on the `evt:start` entry's presence.)
  if (runtime.startDate === CONTINGENT_START_SENTINEL) {
    return null;
  }

  // Validator guarantees dateCursor is defined when any DATE statement exists.
  const anchor = dateCursor as OCTDate;
  // Every DATE statement in a template chains from the same starting date, so
  // that's the origin for the day-of-month — the grant's single vesting day. For
  // the head, anchor and origin are equal (no effect); for a later segment whose
  // anchor landed off the start day, the origin pulls the grid back onto it.
  const origin = runtime.startDate as OCTDate;
  const events = expandAnchored(statement, anchor, dom, firingFor, origin);
  // A pure milestone carries no schedule, so it advances the chain cursor by the
  // same degenerate one-lump params the kernel folds it on: 1 × 0 steps the cursor
  // by zero, the correct milestone handoff. The `period_type` is inert at
  // `period: 0` but must be supplied for the now-absent grid fields to typecheck.
  const grid = statement.schedule ?? {
    occurrences: 1,
    period: 0,
    period_type: "DAYS",
  };
  const nextCursor = advanceCursor(
    anchor,
    grid.occurrences,
    grid.period,
    grid.period_type,
    dom,
    origin,
  );
  return { events, nextCursor };
};

/**
 * Core compile, numeric. Expands every statement onto the shared grid, then hands
 * the whole event stream to the kernel's allocator, which orders it and turns the
 * fractions into exact integer shares (with the grant-date fold applied).
 */
const compileRaw = (
  template: VestingScheduleTemplate,
  totalShares: number,
  runtime: VestingRuntime,
): CompiledInstallment[] => {
  // Safe-integer, not merely integer: Number.isInteger(2 ** 53 + 2) is true,
  // but the allocator's Number cast needs MAX_SAFE (see floorSharesAt).
  if (!Number.isSafeInteger(totalShares) || totalShares < 0) {
    throw new Error(
      `totalShares must be a non-negative safe integer (got ${totalShares})`,
    );
  }
  assertValidVestingScheduleTemplate(template);
  assertValidVestingRuntime(runtime, template);

  // The event-hold firing lookup: a statement's `event_condition` releases its grid
  // only once the matching firing is present in the runtime. Built once and shared.
  // Empty in the firing-blind interchange world (StoredTerms carries no firings),
  // so every event-held statement reads as unfired there and projects nothing.
  const firingByEvent = new Map<string, OCTDate>(
    (runtime.eventFirings ?? []).map((f) => [f.event_id, f.date]),
  );
  const firingFor = (eventId: string): OCTDate | undefined =>
    firingByEvent.get(eventId);

  // Expand each statement; every statement chains through dateCursor.
  const statements = [...template.statements].sort((a, b) => a.order - b.order);
  let dateCursor: OCTDate | undefined = runtime.startDate;
  const rawEvents: RawEvent[] = [];
  for (const statement of statements) {
    const result = expandStatement(statement, runtime, dateCursor, firingFor);
    if (!result) continue; // unresolved contingent placeholder — no tranches
    rawEvents.push(...result.events);
    dateCursor = result.nextCursor;
  }

  return allocateEvents(rawEvents, totalShares, runtime.grantDate);
};

/**
 * Compile to numeric installments ({ date, amount: number }), for extended's
 * downstream rendering.
 */
export const compileToInstallments = (
  template: VestingScheduleTemplate,
  totalShares: number,
  runtime: VestingRuntime,
): CompiledInstallment[] => compileRaw(template, totalShares, runtime);

/**
 * Compile to OCF/Carta-native vesting events ({ date, amount: string }), the
 * shape OCF-Tools consumes directly.
 */
export const compile = (
  template: VestingScheduleTemplate,
  totalShares: number,
  runtime: VestingRuntime,
): CompiledEvent[] =>
  compileRaw(template, totalShares, runtime).map((e) => ({
    date: e.date,
    amount: String(e.amount),
  }));
