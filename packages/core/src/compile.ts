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
import { addPeriod, gt } from "./dates";
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
 * Expand a statement's occurrences into raw events anchored at `anchor`, applying
 * the time-based cliff by date. `multiplier` scales every fraction (EVENT
 * statements pass realized_fraction; DATE statements pass ONE). All fractions are
 * already multiplied through by statement.percentage, so they are fraction of
 * grant, not of the statement.
 *
 * Cliffless: every occurrence vests statement.percentage / N at its grid date.
 *
 * With a cliff: the cliff date is `cliff.length` `cliff.period_type`s after the
 * anchor. Occurrences whose grid date is at/before the cliff date are subsumed
 * into a single lump on the cliff date (`cliff.percentage` of the statement);
 * occurrences after the cliff split the remaining `1 − cliff.percentage` evenly,
 * each at its own grid date. Because the cliff is a duration (not an occurrence
 * index), the lump lands on the true cliff date even when it falls between grid
 * points. On-grid cliffs reproduce the positional result exactly.
 */
const expandAnchored = (
  statement: VestingStatement,
  anchor: OCFDate,
  multiplier: Fraction,
  dom: VestingRuntime["vestingDayOfMonth"],
): RawEvent[] => {
  const N = statement.occurrences;
  const stmtFraction = statement.percentage;
  const gridDate = (i: number): OCFDate =>
    addPeriod(anchor, i * statement.period, statement.period_type, dom);
  const event = (
    date: OCFDate,
    fraction: Fraction,
    occurrence: number,
  ): RawEvent => ({
    date,
    fractionOfGrant: fracMul(fraction, multiplier),
    statementOrder: statement.order,
    occurrence,
  });
  const evenGrid = (): RawEvent[] => {
    const per = fracMul(stmtFraction, { numerator: 1, denominator: N });
    return Array.from({ length: N }, (_, idx) =>
      event(gridDate(idx + 1), per, idx + 1),
    );
  };

  if (!statement.cliff) return evenGrid();

  const cliff = statement.cliff;
  const cliffDate = addPeriod(anchor, cliff.length, cliff.period_type, dom);

  // Partition occurrences: those strictly after the cliff date keep their own
  // grid date; the rest are subsumed into the lump.
  const postOccurrences: number[] = [];
  let preCount = 0;
  for (let i = 1; i <= N; i++) {
    if (gt(gridDate(i), cliffDate)) postOccurrences.push(i);
    else preCount++;
  }

  // Cliff at/before the first installment → no lump, plain grid.
  if (preCount === 0) return evenGrid();

  const events: RawEvent[] = [];
  // The lump (occurrence 0 sorts it first within the statement on its date).
  events.push(event(cliffDate, fracMul(stmtFraction, cliff.percentage), 0));

  // The remaining 1 − cliff.percentage spreads over the post-cliff occurrences.
  // (When none remain — cliff at/after the last grid date — only the lump vests.)
  const P = postOccurrences.length;
  if (P > 0) {
    const per = fracMul(
      stmtFraction,
      fracMul(fracSub(ONE, cliff.percentage), { numerator: 1, denominator: P }),
    );
    for (const i of postOccurrences) events.push(event(gridDate(i), per, i));
  }
  return events;
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
  dateCursor: OCFDate | undefined,
): { events: RawEvent[]; nextCursor: OCFDate | undefined } | null => {
  const dom = runtime.vestingDayOfMonth;

  if (statement.vesting_base.type === "DATE") {
    // Validator guarantees dateCursor is defined when any DATE statement exists.
    const anchor = dateCursor as OCFDate;
    const events = expandAnchored(statement, anchor, ONE, dom);
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
  return {
    events: expandAnchored(statement, firing.date, multiplier, dom),
    nextCursor: dateCursor,
  };
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
