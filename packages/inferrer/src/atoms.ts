import { addDays, addMonthsRule } from "@vestlang/evaluator";
import type {
  OCTDate,
  Statement,
  vesting_day_of_month,
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
    type: "SINGLETON",
    base: { type: "DATE", value: date },
    offsets: [],
  };
}

function backOnePeriod(
  date: OCTDate,
  cadence: { unit: "DAYS" | "MONTHS"; length: number },
  policy: vesting_day_of_month,
): OCTDate {
  const ctx = minimalCtx(policy);
  if (cadence.unit === "MONTHS") {
    return addMonthsRule(date, -cadence.length, ctx);
  }
  return addDays(date, -cadence.length);
}

function buildUniform(
  c: UniformComponent,
  policy: vesting_day_of_month,
): Statement {
  const total = c.perTrancheAmount * c.occurrences;
  const vestingStart = backOnePeriod(c.startDate, c.cadence, policy);
  const periodicity: VestingPeriod = {
    type: c.cadence.unit,
    length: c.cadence.length,
    occurrences: c.occurrences,
  };
  return {
    amount: { type: "QUANTITY", value: total },
    expr: {
      type: "SINGLETON",
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
    amount: { type: "QUANTITY", value: c.amount },
    expr: {
      type: "SINGLETON",
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
      type: "SINGLETON",
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
    amount: { type: "QUANTITY", value: total },
    expr: {
      type: "SINGLETON",
      vesting_start: bareDate(c.grantDate),
      periodicity,
    },
  };
}

export function buildStatement(
  c: Component,
  policy: vesting_day_of_month,
): Statement {
  if (c.kind === "UNIFORM") return buildUniform(c, policy);
  if (c.kind === "SINGLE_TRANCHE") return buildSingle(c);
  return buildCliffUniform(c);
}
