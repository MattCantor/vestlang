import { normalizeVestingNode } from "./core.js";
import { NormalizeAndSort } from "./utils.js";
import {
  Duration,
  Offsets,
  RawSchedule,
  RawScheduleExpr,
  RawStatement,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";

type SYSTEM_EVENT = "grantDate" | "vestingStart";

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
  const startNode = s.vesting_start ?? {
    type: "SINGLETON",
    base: {
      type: "EVENT",
      value: "grantDate",
    },
    offsets: [] as Offsets,
  };
  const vesting_start = normalizeVestingStart(startNode);

  const periodicity = s.periodicity.cliff
    ? {
        ...s.periodicity,
        cliff: normalizeCliff(s.periodicity.cliff),
      }
    : ({ ...s.periodicity } as VestingPeriod);

  return { ...s, vesting_start, periodicity };
}

function normalizeNode(
  c: Duration | VestingNodeExpr,
  durationRef: SYSTEM_EVENT,
): VestingNodeExpr {
  switch (c.type) {
    case "DURATION":
      return {
        type: "SINGLETON",
        base: {
          type: "EVENT",
          value: durationRef,
        },
        offsets: [c],
      };
    case "LATER_OF":
    case "EARLIER_OF":
      return NormalizeAndSort(
        c,
        durationRef === "grantDate" ? normalizeVestingStart : normalizeCliff,
      );
    case "SINGLETON":
      return normalizeVestingNodeExpr(c);
    default:
      throw new Error(
        `normalizeCliff: unexpected cliff type ${(c as any)?.type}`,
      );
  }
}

function normalizeVestingStart(c: Duration | VestingNodeExpr): VestingNodeExpr {
  return normalizeNode(c, "grantDate");
}

function normalizeCliff(c: Duration | VestingNodeExpr): VestingNodeExpr {
  return normalizeNode(c, "vestingStart");
}

/**
 * Normalizes a `vesting_start` or `cliff` expression
 * - BARE or CONSTRAINED vesting node
 * - Selectors (EARLIER_OF/LATER_OF) over `vesting_start` or `cliff` expressions
 */
function normalizeVestingNodeExpr(e: VestingNodeExpr): VestingNodeExpr {
  switch (e.type) {
    case "SINGLETON":
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
