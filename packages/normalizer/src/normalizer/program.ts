import { normalizeVestingNode } from "./core.js";
import { NormalizeAndSort } from "./utils.js";
import {
  ChainedSchedule,
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
  // A THEN tail has no start of its own — it continues from the previous
  // segment's end. Leave its start null rather than filling in the grant date
  // the way an ordinary statement's absent FROM is filled.
  if (s.chained) {
    return {
      chained: true,
      amount: s.amount,
      expr: normalizeChainedSchedule(s.expr),
    };
  }
  return {
    amount: s.amount,
    expr: normalizeScheduleExpr(s.expr),
  };
}

/**
 * Normalize a chained tail: same cliff/periodicity handling as a schedule, but
 * the start stays null (the resolver supplies the handoff date later).
 */
function normalizeChainedSchedule(s: ChainedSchedule<"raw">): ChainedSchedule {
  const periodicity = s.periodicity.cliff
    ? {
        ...s.periodicity,
        cliff: normalizeCliff(s.periodicity.cliff),
      }
    : ({ ...s.periodicity } as VestingPeriod);

  return { type: "SINGLETON", vesting_start: null, periodicity };
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
        `normalizeScheduleExpr: unexpected ScheduleExpr type ${(e as { type?: string })?.type}`,
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
        `normalizeCliff: unexpected cliff type ${(c as { type?: string })?.type}`,
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
        `normalizeVestingNodeExpr: unexpected VestingNode type ${(e as { type?: string })?.type}`,
      );
  }
}
