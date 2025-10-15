import { normalizeVestingNode } from "./core.js";
import { NormalizeAndSort } from "./utils.js";
import {
  RawSchedule,
  RawScheduleExpr,
  RawStatement,
  RawVestingNodeExpr,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingNodeExpr,
} from "@vestlang/types";

/* ------------------------
 * Orchestration
 * ------------------------ */

/**
 * Normalize a single statement
 * `amount` comes already canonical from the grammar
 */
export function normalizeStatement(s: RawStatement): Statement {
  return {
    amount: s.amount,
    expr: normalizeScheduleExpr(s.expr),
  };
}

/**
 * Normalize a ScheduleExpr
 * - SINGLETON schedule
 * - Selectors (EARLIER_OF/LATER_OF) over Schedules
 */
function normalizeScheduleExpr(e: RawScheduleExpr): ScheduleExpr {
  switch (e.type) {
    case "SINGLETON":
      return normalizeSchedule(e);
    case "EARLIER_OF":
    case "LATER_OF":
      return NormalizeAndSort(e, normalizeScheduleExpr);
    default:
      throw new Error(
        `normalizeScheduleExpr: unexpected ScheduleExpr type ${(e as any)?.type}`,
      );
  }
}

/**
 * Normalize a schedule
 * - Normalizes `vesting_start` and optional `cliff`
 * - Periodicity comes already canonical from the grammar
 */
function normalizeSchedule(s: RawSchedule): Schedule {
  const vesting_start = normalizeVestingNodeExpr(s.vesting_start);

  const cliff =
    (s as any).cliff !== undefined
      ? normalizeVestingNodeExpr((s as any).cliff)
      : undefined;

  const periodicity = { ...s.periodicity };

  const out: any = { ...s, vesting_start, periodicity };
  if (cliff !== undefined) out.cliff = cliff;
  return out;
}

/**
 * Normalizes a `vesting_start` or `cliff` expression
 * - BARE or CONSTRAINED vesting node
 * - Selectors (EARLIER_OF/LATER_OF) over `vesting_start` or `cliff` expressions
 */
function normalizeVestingNodeExpr(e: RawVestingNodeExpr): VestingNodeExpr {
  switch (e.type) {
    case "BARE":
    case "CONSTRAINED":
      return normalizeVestingNode(e);
    case "EARLIER_OF":
    case "LATER_OF":
      return NormalizeAndSort(e, normalizeVestingNodeExpr);
    default:
      throw new Error(
        `normalizeVestingNodeExpr: unexpected VestingNode type ${(e as any)?.type}`,
      );
  }
}
