import { normalizeVestingNode } from "./core.js";
import { NormalizeAndSort, type DedupeReport } from "./utils.js";
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
export function normalizeStatement(
  s: RawStatement,
  report?: DedupeReport,
): Statement {
  // A THEN tail has no start of its own — it continues from the previous
  // segment's end. Leave its start null rather than filling in the grant date
  // the way an ordinary statement's absent FROM is filled.
  if (s.chained) {
    return {
      type: "STATEMENT",
      chained: true,
      amount: s.amount,
      expr: normalizeChainedSchedule(s.expr, report),
    };
  }
  return {
    type: "STATEMENT",
    amount: s.amount,
    expr: normalizeScheduleExpr(s.expr, report),
  };
}

/**
 * Normalize a chained tail: same cliff/periodicity handling as a schedule, but
 * the start stays null (the resolver supplies the handoff date later).
 */
function normalizeChainedSchedule(
  s: ChainedSchedule<"raw">,
  report?: DedupeReport,
): ChainedSchedule {
  const periodicity = s.periodicity.cliff
    ? {
        ...s.periodicity,
        cliff: normalizeCliff(s.periodicity.cliff, report),
      }
    : ({ ...s.periodicity } as VestingPeriod);

  return { type: "SCHEDULE", vesting_start: null, periodicity };
}

/**
 * Normalize a ScheduleExpr
 * - a single schedule
 * - a selector (EARLIER OF / LATER OF) over schedules
 */
function normalizeScheduleExpr(
  e: RawScheduleExpr,
  report?: DedupeReport,
): ScheduleExpr {
  switch (e.type) {
    case "SCHEDULE":
      return normalizeSchedule(e, report);
    case "SCHEDULE_EARLIER_OF":
    case "SCHEDULE_LATER_OF":
      return NormalizeAndSort(
        e,
        (x) => normalizeScheduleExpr(x, report),
        report,
      );
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
function normalizeSchedule(s: RawSchedule, report?: DedupeReport): Schedule {
  const startNode = s.vesting_start ?? {
    type: "NODE",
    base: {
      type: "EVENT",
      value: "grantDate",
    },
    offsets: [] as Offsets,
  };
  const vesting_start = normalizeVestingStart(startNode, report);

  const periodicity = s.periodicity.cliff
    ? {
        ...s.periodicity,
        cliff: normalizeCliff(s.periodicity.cliff, report),
      }
    : ({ ...s.periodicity } as VestingPeriod);

  return { ...s, vesting_start, periodicity };
}

function normalizeNode(
  c: Duration | VestingNodeExpr,
  durationRef: SYSTEM_EVENT,
  report?: DedupeReport,
): VestingNodeExpr {
  switch (c.type) {
    case "DURATION":
      return {
        type: "NODE",
        base: {
          type: "EVENT",
          value: durationRef,
        },
        offsets: [c],
      };
    case "NODE_LATER_OF":
    case "NODE_EARLIER_OF":
      return NormalizeAndSort(
        c,
        durationRef === "grantDate"
          ? (x) => normalizeVestingStart(x, report)
          : (x) => normalizeCliff(x, report),
        report,
      );
    case "NODE":
      return normalizeVestingNodeExpr(c, report);
    default:
      throw new Error(
        `normalizeCliff: unexpected cliff type ${(c as { type?: string })?.type}`,
      );
  }
}

function normalizeVestingStart(
  c: Duration | VestingNodeExpr,
  report?: DedupeReport,
): VestingNodeExpr {
  return normalizeNode(c, "grantDate", report);
}

function normalizeCliff(
  c: Duration | VestingNodeExpr,
  report?: DedupeReport,
): VestingNodeExpr {
  return normalizeNode(c, "vestingStart", report);
}

/**
 * Normalizes a `vesting_start` or `cliff` expression
 * - BARE or CONSTRAINED vesting node
 * - a selector (EARLIER OF / LATER OF) over `vesting_start` or `cliff` expressions
 */
function normalizeVestingNodeExpr(
  e: VestingNodeExpr,
  report?: DedupeReport,
): VestingNodeExpr {
  switch (e.type) {
    case "NODE":
      return normalizeVestingNode(e);
    case "NODE_EARLIER_OF":
    case "NODE_LATER_OF":
      return NormalizeAndSort(
        e,
        (x) => normalizeVestingNodeExpr(x, report),
        report,
      );
    default:
      throw new Error(
        `normalizeVestingNodeExpr: unexpected VestingNode type ${(e as { type?: string })?.type}`,
      );
  }
}
