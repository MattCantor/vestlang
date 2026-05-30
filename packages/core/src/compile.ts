// The canonical compile: a template + per-grant runtime + total shares → exact
// integer installments.
//
// Core's engine is vestlang's — the allocator, date math, and fold relocated in
// Phase 2. This file is the orchestration that interprets the canonical IR,
// structured per OCF-Tools' compile.ts (the reference for the IR semantics), and
// it lands the positional cliff (`{occurrence, percentage}` via
// perEventGrantFractions). Every primitive it calls is vestlang's.
//
// Two emit shapes off one engine:
//   - compile(...)             → { date, amount: string }[]  (OCF/Carta-native)
//   - compileToInstallments(…) → { date, amount: number }[]  (for extended)

import type {
  Fraction,
  OCFDate,
  VestingRuntime,
  VestingScheduleTemplate,
  VestingStatement,
} from "./types";
import { allocateExact } from "./allocate";
import { addPeriod } from "./dates";
import { fracAdd, fracMul, fracSub, ONE, ZERO } from "./fractions";
import { foldToGrantDate } from "./fold";
import {
  assertValidVestingRuntime,
  assertValidVestingScheduleTemplate,
} from "./validate";

/** OCF/Carta-native vesting event — amount as a decimal string. */
export interface CompiledEvent {
  date: OCFDate;
  amount: string;
}

/** Numeric installment — for extended's downstream rendering. */
export interface CompiledInstallment {
  date: OCFDate;
  amount: number;
}

/**
 * Per-event fraction-of-grant for each occurrence in a statement (length =
 * statement.occurrences), already multiplied through by statement.percentage so
 * the values are fraction of grant, not of the statement.
 *
 * Cliffless: every event vests statement.percentage / occurrenceCount.
 * With a cliff at occurrence K: events 1..K-1 are ZERO (held back), event K
 * vests cliff.percentage × statement.percentage, and K+1..N split the rest
 * evenly. This is the positional cliff — declarative, exact-rational, and what
 * round-trips to Carta's cliffPercentage/cliffLength.
 */
const perEventGrantFractions = (statement: VestingStatement): Fraction[] => {
  const occurrenceCount = statement.occurrences;
  const stmtFraction = statement.percentage;

  if (!statement.cliff) {
    const eventFraction = fracMul(stmtFraction, {
      numerator: 1,
      denominator: occurrenceCount,
    });
    return Array.from({ length: occurrenceCount }, () => eventFraction);
  }

  // cliff.percentage is the fraction OF THE STATEMENT; multiplying by
  // stmtFraction gives the fraction of grant, so a cliff composes cleanly
  // regardless of how much of the grant the statement covers.
  const cliffEvent = statement.cliff.occurrence;
  const cliffFractionOfStmt = statement.cliff.percentage;
  const cliffFractionOfGrant = fracMul(cliffFractionOfStmt, stmtFraction);
  const postCliffCount = occurrenceCount - cliffEvent;
  const remainingStmtFraction = fracMul(
    fracSub(ONE, cliffFractionOfStmt),
    stmtFraction,
  );
  const postCliffEventFraction =
    postCliffCount === 0
      ? ZERO
      : fracMul(remainingStmtFraction, {
          numerator: 1,
          denominator: postCliffCount,
        });

  return Array.from({ length: occurrenceCount }, (_, idx) => {
    const occurrence = idx + 1;
    // Pre-cliff installments emit ZERO; the main loop's amount===0 filter skips
    // them so no event is produced.
    if (occurrence < cliffEvent) return ZERO;
    if (occurrence === cliffEvent) return cliffFractionOfGrant;
    return postCliffEventFraction;
  });
};

/**
 * Raw event before integer-share materialization: the per-event fraction-of-grant
 * plus enough metadata for a deterministic chronological sort.
 */
interface RawEvent {
  date: OCFDate;
  fractionOfGrant: Fraction;
  statementOrder: number;
  occurrence: number;
}

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
  dateCursor: OCFDate | undefined,
): { events: RawEvent[]; nextCursor: OCFDate | undefined } | null => {
  const fractions = perEventGrantFractions(statement);
  const events: RawEvent[] = [];
  const dom = runtime.vestingDayOfMonth;

  if (statement.vesting_base.type === "DATE") {
    // Validator guarantees dateCursor is defined when any DATE statement exists.
    const anchor = dateCursor as OCFDate;
    for (let i = 1; i <= statement.occurrences; i++) {
      events.push({
        date: addPeriod(anchor, i * statement.period, statement.period_type, dom),
        fractionOfGrant: fractions[i - 1],
        statementOrder: statement.order,
        occurrence: i,
      });
    }
    const nextCursor = addPeriod(
      anchor,
      statement.occurrences * statement.period,
      statement.period_type,
      dom,
    );
    return { events, nextCursor };
  }

  // EVENT-anchored
  const eventId = statement.vesting_base.event_id;
  const firing = runtime.eventFirings?.find((f) => f.event_id === eventId);
  if (!firing) return null; // statement doesn't fire; events never produced

  const multiplier = firing.realized_fraction ?? ONE;
  for (let i = 1; i <= statement.occurrences; i++) {
    events.push({
      date: addPeriod(firing.date, i * statement.period, statement.period_type, dom),
      fractionOfGrant: fracMul(fractions[i - 1], multiplier),
      statementOrder: statement.order,
      occurrence: i,
    });
  }
  return { events, nextCursor: dateCursor };
};

/**
 * Core compile, numeric. Expands statements, sorts chronologically (tie-break:
 * statement.order, then occurrence), allocates with a single running cumulative
 * across the whole template (so the schedule telescopes exactly to totalShares),
 * and applies the grant-date implicit cliff via the shared fold.
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

  // Step 1: expand each statement. DATE statements chain through dateCursor;
  // EVENT statements anchor absolutely at their firing.
  const statements = [...template.statements].sort((a, b) => a.order - b.order);
  let dateCursor: OCFDate | undefined = runtime.startDate;
  const rawEvents: RawEvent[] = [];
  for (const statement of statements) {
    const result = expandStatement(statement, runtime, dateCursor);
    if (!result) continue; // EVENT statement with no matching firing
    rawEvents.push(...result.events);
    dateCursor = result.nextCursor;
  }

  // Step 2: chronological sort, tie-break on (statementOrder, occurrence) so two
  // events on the same date have a deterministic, spec-traceable order.
  rawEvents.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.statementOrder !== b.statementOrder)
      return a.statementOrder - b.statementOrder;
    return a.occurrence - b.occurrence;
  });

  // Step 3: single-cumulative allocation. The cumulative fraction accumulates
  // across all events; amount = alloc(totalShares × cumulative) − vestedSoFar,
  // telescoping to sum exactly to totalShares (when all EVENT statements fire).
  const mode = runtime.allocationType ?? "CUMULATIVE_ROUND_DOWN";
  let cumulative: Fraction = ZERO;
  let vestedSoFar = 0;
  const dates: OCFDate[] = [];
  const amounts: number[] = [];
  for (const raw of rawEvents) {
    cumulative = fracAdd(cumulative, raw.fractionOfGrant);
    const amount = allocateExact(totalShares, cumulative, vestedSoFar, mode);
    if (amount === 0) continue;
    vestedSoFar += amount;
    dates.push(raw.date);
    amounts.push(amount);
  }

  // Step 4: grant-date implicit cliff — amounts dated before grantDate aggregate
  // onto grantDate (vesting can't occur before the grant existed).
  const folded = runtime.grantDate
    ? foldToGrantDate(dates, amounts, runtime.grantDate)
    : { dates, amounts };

  return folded.dates.map((date, i) => ({ date, amount: folded.amounts[i] }));
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
