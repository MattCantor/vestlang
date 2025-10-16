import { normalizeVestingNode } from "./core.js";
import { NormalizeAndSort } from "./utils.js";
import {
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
export function normalizeStatement(s: Statement): Statement {
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
function normalizeScheduleExpr(e: ScheduleExpr): ScheduleExpr {
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
function normalizeSchedule(s: Schedule): Schedule {
  const vesting_start = normalizeVestingNodeExpr(s.vesting_start);

  const periodicity = s.periodicity.cliff
    ? {
        ...s.periodicity,
        cliff: normalizeVestingNodeExpr(s.periodicity.cliff),
      }
    : { ...s.periodicity };

  return { ...s, vesting_start, periodicity };
}

/**
 * Normalizes a `vesting_start` or `cliff` expression
 * - BARE or CONSTRAINED vesting node
 * - Selectors (EARLIER_OF/LATER_OF) over `vesting_start` or `cliff` expressions
 */
function normalizeVestingNodeExpr(e: VestingNodeExpr): VestingNodeExpr {
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
