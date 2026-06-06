import { addDays, addMonthsRule } from "@vestlang/evaluator";
import type {
  OCTDate,
  Statement,
  VestingDayOfMonth,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { minimalCtx } from "./cadence.js";
import type {
  CliffUniformComponent,
  Component,
  SingleTrancheComponent,
  UniformComponent,
} from "./types.js";

function bareDate(date: OCTDate): VestingNodeExpr {
  return {
    type: "NODE",
    base: { type: "DATE", value: date },
    offsets: [],
  };
}

function backOnePeriod(
  date: OCTDate,
  cadence: { unit: "DAYS" | "MONTHS"; length: number },
  policy: VestingDayOfMonth,
): OCTDate {
  const ctx = minimalCtx(policy);
  if (cadence.unit === "MONTHS") {
    return addMonthsRule(date, -cadence.length, ctx);
  }
  return addDays(date, -cadence.length);
}

function buildUniform(
  c: UniformComponent,
  policy: VestingDayOfMonth,
): Statement {
  const total = c.total;
  const vestingStart = backOnePeriod(c.startDate, c.cadence, policy);
  const periodicity: VestingPeriod = {
    type: c.cadence.unit,
    length: c.cadence.length,
    occurrences: c.occurrences,
  };
  return {
    type: "STATEMENT",
    amount: { type: "QUANTITY", value: total },
    expr: {
      type: "SCHEDULE",
      vesting_start: bareDate(vestingStart),
      periodicity,
    },
  };
}

function buildSingle(c: SingleTrancheComponent): Statement {
  const periodicity: VestingPeriod = {
    type: "DAYS",
    length: 0,
    occurrences: 1,
  };
  return {
    type: "STATEMENT",
    amount: { type: "QUANTITY", value: c.amount },
    expr: {
      type: "SCHEDULE",
      vesting_start: bareDate(c.date),
      periodicity,
    },
  };
}

function buildCliffUniform(c: CliffUniformComponent): Statement {
  const totalSteps = c.cliffSteps + c.tailOccurrences;
  const total = c.perTrancheAmount * totalSteps;
  const cliffDurationValue = c.cliffSteps * c.cadence.length;
  const periodicity: VestingPeriod = {
    type: c.cadence.unit,
    length: c.cadence.length,
    occurrences: totalSteps,
    cliff: {
      type: "NODE",
      base: { type: "EVENT", value: "vestingStart" },
      offsets: [
        {
          type: "DURATION",
          value: cliffDurationValue,
          unit: c.cadence.unit,
          sign: "PLUS",
        },
      ],
    },
  };
  return {
    type: "STATEMENT",
    amount: { type: "QUANTITY", value: total },
    expr: {
      type: "SCHEDULE",
      vesting_start: bareDate(c.grantDate),
      periodicity,
    },
  };
}

export function buildStatement(
  c: Component,
  policy: VestingDayOfMonth,
): Statement {
  if (c.kind === "UNIFORM") return buildUniform(c, policy);
  if (c.kind === "SINGLE_TRANCHE") return buildSingle(c);
  return buildCliffUniform(c);
}

/**
 * Re-express a built statement as a THEN continuation: drop its FROM anchor and
 * mark it chained, so the evaluator picks its start up from where the previous
 * segment ended rather than from a date we wrote down. Keeping the date out is
 * what makes a chain survive month-end clamping — a written-down handoff can land
 * a day off the running cursor, but a chained tail can't.
 *
 * Only a plain dated segment can become a tail; a selector head or an existing
 * tail has nothing to continue from, so those are caller bugs.
 */
export function asChainedTail(stmt: Statement): Statement {
  if (stmt.chained) return stmt;
  if (stmt.expr.type !== "SCHEDULE") {
    throw new Error("asChainedTail: only a plain single segment can chain");
  }
  return {
    type: "STATEMENT",
    chained: true,
    amount: stmt.amount,
    expr: {
      type: "SCHEDULE",
      vesting_start: null,
      periodicity: stmt.expr.periodicity,
    },
  };
}
