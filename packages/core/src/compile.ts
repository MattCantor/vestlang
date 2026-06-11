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
  Fraction,
  OCTDate,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "@vestlang/types";
import { addPeriod, advanceCursor } from "./dates";
import { fracMul, ONE } from "@vestlang/utils";
import {
  allocateEvents,
  expandGrid,
  type GridCliff,
  type RawEvent,
} from "./kernel";
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

/**
 * Lower one statement onto the shared grid kernel. The cliff is a duration from
 * the anchor (so the lump lands on its true date, off-grid or not), and the EVENT
 * `multiplier` — realized_fraction for a partial payout, ONE otherwise — folds into
 * the statement's share of the grant before the grid splits it. `origin` carries
 * the chain's first date, the grant's single vesting day that every MONTHS grid
 * anchors to; it defaults to `anchor`.
 */
const expandAnchored = (
  statement: VestingStatement,
  anchor: OCTDate,
  multiplier: Fraction,
  dom: VestingRuntime["vestingDayOfMonth"],
  origin: OCTDate = anchor,
): RawEvent[] => {
  const cliff: GridCliff = statement.cliff
    ? {
        kind: "fixed",
        date: addPeriod(
          anchor,
          statement.cliff.length,
          statement.cliff.period_type,
          dom,
        ),
        percentage: statement.cliff.percentage,
      }
    : { kind: "none" };

  return expandGrid({
    anchor,
    origin,
    period: statement.period,
    periodType: statement.period_type,
    occurrences: statement.occurrences,
    stmtFraction: fracMul(statement.percentage, multiplier),
    statementOrder: statement.order,
    dom,
    cliff,
  });
};

/**
 * Expand one statement into raw events.
 *
 * DATE-anchored: events anchor at dateCursor; the cursor advances by the full
 * statement duration (occurrences × period), so statement N+1 chains off where N
 * ended (the 5/15/40/40 graded semantic).
 *
 * EVENT-anchored: events anchor at the matching firing's date; the cursor is NOT
 * advanced (EVENT statements float free of the DATE chain). No matching firing →
 * the statement is skipped (returns null), leaving that portion unvested.
 * realized_fraction scales each per-event fraction for partial payouts.
 */
const expandStatement = (
  statement: VestingStatement,
  runtime: VestingRuntime,
  dateCursor: OCTDate | undefined,
): { events: RawEvent[]; nextCursor: OCTDate | undefined } | null => {
  const dom = runtime.vestingDayOfMonth;

  if (statement.vesting_base.type === "DATE") {
    // Validator guarantees dateCursor is defined when any DATE statement exists.
    const anchor = dateCursor as OCTDate;
    // Every DATE statement in a template chains from the same starting date, so
    // that's the origin for the day-of-month — the grant's single vesting day.
    // For the head, anchor and origin are equal (no effect); for a later segment
    // whose anchor landed off the start day, the origin pulls the grid back onto
    // it.
    const origin = runtime.startDate as OCTDate;
    const events = expandAnchored(statement, anchor, ONE, dom, origin);
    const nextCursor = advanceCursor(
      anchor,
      statement.occurrences,
      statement.period,
      statement.period_type,
      dom,
      origin,
    );
    return { events, nextCursor };
  }

  // EVENT-anchored
  const eventId = statement.vesting_base.event_id;
  const firing = runtime.eventFirings?.find((f) => f.event_id === eventId);
  if (!firing) return null; // statement doesn't fire; events never produced

  const multiplier = firing.realized_fraction ?? ONE;
  return {
    events: expandAnchored(statement, firing.date, multiplier, dom),
    nextCursor: dateCursor,
  };
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
  if (!Number.isInteger(totalShares) || totalShares < 0) {
    throw new Error(
      `totalShares must be a non-negative integer (got ${totalShares})`,
    );
  }
  assertValidVestingScheduleTemplate(template);
  assertValidVestingRuntime(runtime, template);

  // Expand each statement. DATE statements chain through dateCursor; EVENT
  // statements anchor absolutely at their firing.
  const statements = [...template.statements].sort((a, b) => a.order - b.order);
  let dateCursor: OCTDate | undefined = runtime.startDate;
  const rawEvents: RawEvent[] = [];
  for (const statement of statements) {
    const result = expandStatement(statement, runtime, dateCursor);
    if (!result) continue; // EVENT statement with no matching firing
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
