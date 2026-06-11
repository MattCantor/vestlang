import type {
  OCTDate,
  Statement,
  SystemAnchorTag,
  VestingDayOfMonth,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { walk } from "./cadence.js";
import type {
  CliffUniformComponent,
  Component,
  SingleTrancheComponent,
  UniformComponent,
} from "./types.js";

// A bare DATE anchor is positionally neutral — it fits a start or a cliff slot —
// so the result is generic over the permitted anchor and infers it from context.
function bareDate<A extends SystemAnchorTag = SystemAnchorTag>(
  date: OCTDate,
): VestingNodeExpr<A> {
  return {
    type: "NODE",
    base: { type: "DATE", value: date },
    offsets: [],
  };
}

function buildUniform(
  c: UniformComponent,
  policy: VestingDayOfMonth,
): Statement {
  const total = c.total;
  // The vesting start sits one period before the first installment: a FROM-anchored
  // train's first tranche lands at start + 1 period, so back the start out by one.
  const vestingStart = walk(c.startDate, c.cadence, -1, policy);
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
      base: { type: "VESTING_START" },
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
 * what lets the tail grid on the grant's vesting day (the chain origin's): a
 * written-down handoff would pin the tail to whatever day the previous segment
 * landed on, but a chained tail inherits the origin instead.
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
