// The canonical compile: a template, a per-grant runtime, and a total share
// count become exact integer installments.
//
// The engine is vestlang's own. The allocator, date math, and fold are all
// vestlang primitives; this file adds the orchestration that walks the canonical
// IR, with the cliff applied by date rather than by occurrence index (see
// expandAnchored).
//
// One engine, two output shapes:
//   compile(...)             -> { date, amount: string }[]  (OCF-native)
//   compileToInstallments(…) -> { date, amount: number }[]  (consumed by extended)

import type {
  OCTDate,
  VestingRuntime,
  OCFVestingTermsV2,
  OCFVestingStatement,
} from "@vestlang/types";
import {
  addPeriod,
  advanceCursor,
  allocateEvents,
  expandStatementGrid,
  type CliffInput,
  type RawEvent,
} from "@vestlang/primitives";
import { CONTINGENT_START_SENTINEL, numericToFraction } from "@vestlang/utils";
import {
  assertValidVestingRuntime,
  assertValidVestingScheduleTemplate,
} from "./validate";

/** OCF-native vesting event — amount as a decimal string. */
export interface CompiledEvent {
  date: OCTDate;
  amount: string;
}

/** Numeric installment — for extended's downstream rendering. */
export interface CompiledInstallment {
  date: OCTDate;
  amount: number;
}

// A pure milestone carries no time grid in storage, so it folds on a degenerate
// one-lump grid — a single installment at `anchor + 0`. `period_type` is inert at
// `period: 0`, so its value is arbitrary but must be supplied. Both the expansion
// (the kernel folds the lump on these params) and the cursor advance (1 × 0 steps
// the cursor by zero, the milestone handoff) share this one constant.
const MILESTONE_GRID = {
  occurrences: 1,
  period: 0,
  period_type: "DAYS",
} as const;

// The statement union is structural: only the scheduled arm carries `schedule`, so
// reading it means narrowing on the key's presence first. A pure milestone has no
// schedule, so this yields `undefined` for it.
const scheduleOf = (statement: OCFVestingStatement) =>
  "schedule" in statement ? statement.schedule : undefined;

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
 * The stored time `cliff`'s percentage is the interchange-facing baseline and is not
 * applied as its own lump; only its date contributes (the floor in the max).
 */
const expandAnchored = (
  statement: OCFVestingStatement,
  anchor: OCTDate,
  dom: VestingRuntime["vestingDayOfMonth"],
  firingFor: (eventId: string) => OCTDate | undefined,
  origin: OCTDate = anchor,
): RawEvent[] => {
  // Narrow once on `schedule` presence. A pure milestone carries no time grid in
  // storage, so it folds on the degenerate one-lump grid (see MILESTONE_GRID). A
  // scheduled statement reads its grid and cliff straight off `statement.schedule`.
  const schedule = scheduleOf(statement);
  const grid = schedule ?? MILESTONE_GRID;
  const cliffSpec = schedule?.cliff;

  // The time baseline date, when the statement carries a time cliff.
  const baselineDate = cliffSpec
    ? addPeriod(anchor, cliffSpec.length, cliffSpec.period_type, dom)
    : undefined;

  // Map the statement's source shape onto the firing-blind CliffInput; the helper
  // owns the arm decision, the proportional fold, and the kernel call. An event
  // hold whose firing is absent skips (no tranches — a pure milestone always takes
  // this path while unfired); fired, it folds the held grid proportionally at the
  // firing, with the time baseline as a floor.
  let cliff: CliffInput;
  if (statement.event_condition) {
    const firing = firingFor(statement.event_condition.event_id);
    cliff =
      firing === undefined
        ? { kind: "skip" }
        : { kind: "proportional", firing, floor: baselineDate };
  } else if (cliffSpec && baselineDate !== undefined) {
    cliff = {
      kind: "fixed",
      baselineDate,
      // Stored as a Numeric decimal; the kernel works in exact rational.
      percentage: numericToFraction(cliffSpec.percentage),
    };
  } else {
    cliff = { kind: "none" };
  }

  return expandStatementGrid(
    {
      anchor,
      origin,
      period: grid.period,
      periodType: grid.period_type,
      occurrences: grid.occurrences,
      stmtFraction: numericToFraction(statement.percentage),
      statementOrder: statement.order,
      dom,
    },
    cliff,
  );
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
  statement: OCFVestingStatement,
  runtime: VestingRuntime,
  dateCursor: OCTDate | undefined,
  firingFor: (eventId: string) => OCTDate | undefined,
): { events: RawEvent[]; nextCursor: OCTDate | undefined } | null => {
  // OCF carries the day-of-month policy per-segment, so prefer the segment's own
  // value; the grant-level runtime value is the fallback, and the canonical default
  // backstops both (the primitives stepper applies it when `dom` is undefined). A
  // pure milestone has no segment, so it takes the runtime value — inert there,
  // since a milestone folds as a single lump and the policy only bites on a
  // MONTHS/YEARS grid.
  const schedule = scheduleOf(statement);
  const dom = schedule?.vesting_day_of_month ?? runtime.vestingDayOfMonth;

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
  // same degenerate one-lump params the kernel folds it on (see MILESTONE_GRID).
  const grid = schedule ?? MILESTONE_GRID;
  // The handoff to the next statement's anchor is computed with this (the producing)
  // segment's day-of-month policy. Moot for a vestlang-produced template — every
  // segment shares one policy — but for an ingested template whose segments carry
  // differing policies, the next anchor lands on the policy of the segment that
  // produced it.
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
 * Expand a template + runtime to the raw fraction-events the allocator consumes —
 * the front half of `compile`, split out so the evaluator can run its own
 * provenance-carrying allocate over the same expansion (one allocation algorithm
 * feeds the public compile path and the eval-time breakdown). It RETAINS the full
 * compile-path validation: the safe-integer guard plus both `assertValid*` checks,
 * so no caller gets a silently-unvalidated expansion. The output is a pre-allocation
 * `RawEvent[]` carrying the `statementOrder` core already stamps — categorically not
 * an installment and not attribution.
 */
export const expandTemplateToRawEvents = (
  template: OCFVestingTermsV2,
  totalShares: number,
  runtime: VestingRuntime,
): RawEvent[] => {
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
  // Empty in the firing-blind storable world (StoredTerms carries no firings),
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
  return rawEvents;
};

/**
 * Core compile, numeric. Expands every statement onto the shared grid, then hands
 * the whole event stream to the kernel's allocator, which orders it and turns the
 * fractions into exact integer shares (with the grant-date fold applied).
 */
const compileRaw = (
  template: OCFVestingTermsV2,
  totalShares: number,
  runtime: VestingRuntime,
): CompiledInstallment[] =>
  allocateEvents(
    expandTemplateToRawEvents(template, totalShares, runtime),
    totalShares,
    runtime.grantDate,
  );

/**
 * Compile to numeric installments ({ date, amount: number }), for extended's
 * downstream rendering.
 *
 * `compile` does not certify allocatability — pair it with
 * `validateTemplateAllocatable`. There is no allocatability check here: an
 * over-allocating template (statements summing past 100%) compiles to an
 * over-vesting installment stream with no finding, warning, or throw — the
 * allocator over-vests by design and doesn't clamp. Run
 * `validateTemplateAllocatable` / `templateAllocationFindings` first if you need
 * to know whether the template fits the grant.
 */
export const compileToInstallments = (
  template: OCFVestingTermsV2,
  totalShares: number,
  runtime: VestingRuntime,
): CompiledInstallment[] => compileRaw(template, totalShares, runtime);

/**
 * Compile to OCF-native vesting events ({ date, amount: string }), the
 * shape OCF-Tools consumes directly.
 *
 * `compile` does not certify allocatability — pair it with
 * `validateTemplateAllocatable`. Same caveat as `compileToInstallments`: this
 * validates structure and runtime but not allocatability, so an over-allocating
 * template silently compiles to an over-vesting stream (no finding/warning/throw).
 * A consumer that wants to refuse an over-100% template must call
 * `validateTemplateAllocatable` / `templateAllocationFindings` before compiling.
 */
export const compile = (
  template: OCFVestingTermsV2,
  totalShares: number,
  runtime: VestingRuntime,
): CompiledEvent[] =>
  compileRaw(template, totalShares, runtime).map((e) => ({
    date: e.date,
    amount: String(e.amount),
  }));
