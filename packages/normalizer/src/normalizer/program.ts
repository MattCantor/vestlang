import { normalizeVestingNode } from "./core.js";
import { normalizeAndDedupe, type FindingSink } from "./utils.js";
import {
  ChainedSchedule,
  Duration,
  DurationOffsets,
  Offsets,
  RawSchedule,
  RawScheduleExpr,
  RawStatement,
  Schedule,
  ScheduleExpr,
  Statement,
  SystemAnchorTag,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";

/* ------------------------
 * Orchestration
 * ------------------------ */

/**
 * Normalize a single statement
 * `amount` comes already canonical from the grammar
 */
export function normalizeStatement(
  s: RawStatement,
  report?: FindingSink,
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
  report?: FindingSink,
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
  report?: FindingSink,
): ScheduleExpr {
  switch (e.type) {
    case "SCHEDULE":
      return normalizeSchedule(e, report);
    case "SCHEDULE_EARLIER_OF":
    case "SCHEDULE_LATER_OF":
      return normalizeAndDedupe(
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
function normalizeSchedule(s: RawSchedule, report?: FindingSink): Schedule {
  const startNode = s.vesting_start ?? {
    type: "NODE",
    base: { type: "GRANT_DATE" },
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
  c: Duration | DurationOffsets | VestingNodeExpr,
  anchor: SystemAnchorTag,
  report?: FindingSink,
): VestingNodeExpr {
  switch (c.type) {
    case "DURATION":
      return {
        type: "NODE",
        base: { type: anchor },
        offsets: [c],
      };
    // A bare multi-term offset selector arm. The grammar can't anchor it (an arm
    // has no fixed system base at parse time), so the raw carrier reaches here and
    // we anchor it to the slot base, spreading the already-aggregated offsets — the
    // same NODE the written-out `grantDate + 20 days + 1 month` arm produces.
    case "DURATION_OFFSETS":
      return {
        type: "NODE",
        base: { type: anchor },
        offsets: c.offsets,
      };
    case "NODE_LATER_OF":
    case "NODE_EARLIER_OF": {
      // Each arm normalizes under the same anchor as the selector. The wrappers
      // return slot-narrowed exprs; widen back to VestingNodeExpr here so the two
      // branches share one return type (normalizeAndDedupe infers a single arm type).
      const normalizeArm = (x: VestingNodeExpr): VestingNodeExpr =>
        anchor === "GRANT_DATE"
          ? normalizeVestingStart(x, report)
          : normalizeCliff(x, report);
      return normalizeAndDedupe(c, normalizeArm, report);
    }
    case "NODE":
      return normalizeVestingNodeExpr(c, report);
    default:
      // Label matches this function; the broad single-sourcing of these throw
      // strings is deferred to #475.
      throw new Error(
        `normalizeNode: unexpected node type ${(c as { type?: string })?.type}`,
      );
  }
}

// The two slot wrappers are the one place where the positional invariant crosses
// from a runtime guarantee into the type. The parser (70-schedule.peggy) already
// rejects the forbidden anchor — VESTING_START in a FROM, GRANT_DATE in a CLIFF —
// at any selector depth (#110), and normalizeNode mints the correct system anchor
// for bare durations while preserving the parsed base otherwise. So the result
// carries only DATE / EVENT / the slot's own anchor; pinning the return type here
// is the single annotated point per slot — everything downstream is structurally
// unable to re-introduce the mistake.

function normalizeVestingStart(
  c: Duration | DurationOffsets | VestingNodeExpr,
  report?: FindingSink,
): VestingNodeExpr<"GRANT_DATE"> {
  return normalizeNode(c, "GRANT_DATE", report);
}

function normalizeCliff(
  c: Duration | DurationOffsets | VestingNodeExpr,
  report?: FindingSink,
): VestingNodeExpr<"VESTING_START"> {
  return normalizeNode(c, "VESTING_START", report);
}

/**
 * Normalizes a `vesting_start` or `cliff` expression
 * - BARE or CONSTRAINED vesting node
 * - a selector (EARLIER OF / LATER OF) over `vesting_start` or `cliff` expressions
 */
function normalizeVestingNodeExpr(
  e: VestingNodeExpr,
  report?: FindingSink,
): VestingNodeExpr {
  switch (e.type) {
    case "NODE":
      return normalizeVestingNode(e, report);
    case "NODE_EARLIER_OF":
    case "NODE_LATER_OF":
      return normalizeAndDedupe(
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
