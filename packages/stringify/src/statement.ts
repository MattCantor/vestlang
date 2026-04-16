import type {
  Amount,
  AmountPortion,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingNodeExpr,
  VestingPeriod,
} from "@vestlang/types";
import { kw, parenGroup } from "./utils.js";
import { stringifyDuration, stringifyVestingNodeExpr } from "./vesting-node.js";

/**
 * Stringify a Statement.
 */
export function stringifyStatement(s: Statement): string {
  const parts: string[] = [];
  const amount = stringifyAmount(s.amount);
  if (amount) {
    parts.push(amount);
  }
  parts.push(kw("VEST"));
  const schedule = stringifyScheduleExpr(s.expr);
  if (schedule) {
    parts.push(schedule);
  }
  return parts.join(" ");
}

/**
 * Stringify a ScheduleExpr (SINGLETON, LATER_OF, or EARLIER_OF).
 */
function stringifyScheduleExpr(e: ScheduleExpr): string {
  switch (e.type) {
    case "SINGLETON":
      return stringifySchedule(e);
    case "LATER_OF":
    case "EARLIER_OF": {
      const keyword = kw(e.type.replace("_", " "));
      const items = e.items.map((item) => stringifyScheduleExpr(item));
      return parenGroup(keyword, items);
    }
  }
}

/**
 * Stringify a Schedule.
 */
function stringifySchedule(s: Schedule): string {
  const parts: string[] = [];

  // FROM clause
  //   - Omit entirely if default grantDate with no offsets/constraints.
  //   - Sugar `EVENT grantDate +N months` → bare duration (`FROM N months`),
  //     since the grammar's `FROM Duration` form normalizes to exactly this
  //     shape.
  if (!isDefaultVestingStart(s.vesting_start)) {
    const sugared = sugaredAnchorDuration(s.vesting_start, "grantDate");
    parts.push(kw("FROM"));
    parts.push(sugared ?? stringifyVestingNodeExpr(s.vesting_start));
  }

  // Periodicity (OVER/EVERY)
  const periodicity = stringifyPeriodicity(s.periodicity);
  if (periodicity) {
    parts.push(periodicity);
  }

  // CLIFF
  //   - Sugar `EVENT vestingStart +N months` → bare duration (`CLIFF N
  //     months`), since the grammar's `CLIFF Duration` form normalizes to
  //     exactly this shape.
  if (s.periodicity.cliff) {
    const sugared = sugaredAnchorDuration(s.periodicity.cliff, "vestingStart");
    parts.push(kw("CLIFF"));
    parts.push(sugared ?? stringifyVestingNodeExpr(s.periodicity.cliff));
  }

  return parts.join(" ");
}

/**
 * Check if vesting_start is the default (EVENT grantDate with no offsets/constraints).
 */
function isDefaultVestingStart(vs: Schedule["vesting_start"]): boolean {
  if (vs.type !== "SINGLETON") return false;
  if (vs.base.type !== "EVENT") return false;
  if (vs.base.value !== "grantDate") return false;
  if (vs.offsets && vs.offsets.length > 0) return false;
  if (vs.constraints) return false;
  return true;
}

/**
 * If `node` is exactly `{ base: EVENT <systemEvent>, offsets: [duration],
 * no constraints }`, return the bare-duration DSL text. Otherwise return
 * null so the caller falls back to the full form.
 *
 * This mirrors the grammar's sugar forms: `FROM 6 months` is parsed as
 * `FROM EVENT grantDate + 6 months`, and `CLIFF 6 months` as `CLIFF EVENT
 * vestingStart + 6 months`. Round-tripping without this collapse is still
 * correct (identical AST after re-parse) but verbose and confusing for
 * human readers.
 */
function sugaredAnchorDuration(
  node: VestingNodeExpr,
  systemEvent: "grantDate" | "vestingStart",
): string | null {
  if (node.type !== "SINGLETON") return null;
  if (node.base.type !== "EVENT") return null;
  if (node.base.value !== systemEvent) return null;
  if (node.constraints) return null;
  if (!node.offsets || node.offsets.length !== 1) return null;
  const offset = node.offsets[0];
  if (offset.sign !== "PLUS") return null;
  return stringifyDuration(offset).slice(1); // drop the leading '+'
}

/**
 * Stringify periodicity (OVER/EVERY).
 */
function stringifyPeriodicity(p: VestingPeriod): string {
  if (p.length === 0) return "";
  const total = p.length * p.occurrences;
  const unit = p.type.toLowerCase();
  return `${kw("OVER")} ${total} ${unit} ${kw("EVERY")} ${p.length} ${unit}`;
}

/**
 * Stringify an Amount. Returns empty string for default 1/1 portion.
 */
function stringifyAmount(a: Amount): string {
  if (a.type === "QUANTITY") {
    return String(a.value);
  }
  const p = a as AmountPortion;
  // Omit default 1/1 portion
  if (p.numerator === 1 && p.denominator === 1) {
    return "";
  }
  return `${p.numerator}/${p.denominator}`;
}
