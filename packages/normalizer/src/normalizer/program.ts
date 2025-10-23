import { normalizeVestingNode } from "./core.js";
import { NormalizeAndSort } from "./utils.js";
import {
  BareVestingNode,
  Duration,
  Offsets,
  RawSchedule,
  RawScheduleExpr,
  RawStatement,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingNode,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";

type SYSTEM_EVENT = "grantdate" | "vestingstart";

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
  const vesting_start = normalizeVestingStart(
    s.vesting_start ??
      ({
        type: "BARE",
        base: {
          type: "EVENT",
          value: "grantDate",
        },
        offsets: [] as Offsets,
      } as BareVestingNode),
  );

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
        type: "BARE",
        base: {
          type: "EVENT",
          value: durationRef,
        },
        offsets: [c],
      };
    case "LATER_OF":
    case "EARLIER_OF":
      return NormalizeAndSort(c, normalizeCliff);
    case "BARE":
    case "CONSTRAINED":
      return normalizeVestingNodeExpr(c);
    default:
      throw new Error(
        `normalizeCliff: unexpected cliff type ${(c as any)?.type}`,
      );
  }
}

function normalizeVestingStart(c: Duration | VestingNodeExpr): VestingNodeExpr {
  return normalizeNode(c, "grantdate");
}

function normalizeCliff(c: Duration | VestingNodeExpr): VestingNodeExpr {
  return normalizeNode(c, "vestingstart");
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
