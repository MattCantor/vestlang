import type {
  Amount,
  AmountPortion,
  Schedule,
  ScheduleExpr,
  Statement,
  VestingPeriod,
} from "@vestlang/types";
import { kw, parenGroup } from "./utils.js";
import { stringifyVestingNodeExpr } from "./vesting-node.js";

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

  // FROM clause (omit if default grantDate with no offsets/constraints)
  if (!isDefaultVestingStart(s.vesting_start)) {
    parts.push(kw("FROM"));
    parts.push(stringifyVestingNodeExpr(s.vesting_start));
  }

  // Periodicity (OVER/EVERY)
  const periodicity = stringifyPeriodicity(s.periodicity);
  if (periodicity) {
    parts.push(periodicity);
  }

  // CLIFF
  if (s.periodicity.cliff) {
    parts.push(kw("CLIFF"));
    parts.push(stringifyVestingNodeExpr(s.periodicity.cliff));
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
