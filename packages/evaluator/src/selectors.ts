import {
  ScheduleExpr,
  OCTDate,
  Schedule as NormalizedSchedule,
  SelectorTag,
} from "@vestlang/types";
import { EvaluationContext, PickedSchedule } from "./types.js";
import { resolveNodeExpr } from "./resolve.js";
import { lt } from "./time.js";

/* ------------------------
 * Schedule selectors picked by vesting_start
 * ------------------------ */

/**
 * Choose which ScheduleExpr should apply be comparing resolved vesting_start dates.
 * - EARLIER_OF: pick earliest resolved start
 * - LATER_OF: pick latest resolved start (requires all resolved)
 */
export function pickScheduleByStart(
  items: ScheduleExpr[],
  ctx: EvaluationContext,
  mode: SelectorTag,
): PickedSchedule {
  let candidate: { schedule: NormalizedSchedule; start: OCTDate } | undefined;
  let unresolved = false;

  for (const item of items) {
    if (item.type !== "SINGLETON") {
      // Recurse into nested selectors
      const sub = pickScheduleByStart((item as any).items, ctx, item.type);
      if (!sub.chosen) {
        unresolved ||= sub.unresolved;
        continue;
      }
      const startDate = sub.vesting_start!;
      if (!candidate) candidate = { schedule: sub.chosen, start: startDate };
      else {
        const better =
          mode === "EARLIER_OF"
            ? lt(startDate, candidate.start)
            : lt(candidate.start, startDate);
        if (better) candidate = { schedule: sub.chosen, start: startDate };
      }
      continue;
    }

    const startRes = resolveNodeExpr(item.vesting_start, ctx);
    if (startRes.state === "inactive") continue; // ignore inactive
    if (startRes.state !== "resolved") {
      unresolved = true;
      continue;
    }

    if (!candidate) candidate = { schedule: item, start: startRes.date };
    else {
      const better =
        mode === "EARLIER_OF"
          ? lt(startRes.date, candidate.start)
          : lt(candidate.start, startRes.date);
      if (better) candidate = { schedule: item, start: startRes.date };
    }
  }

  if (!candidate) return { unresolved };
  return {
    chosen: candidate.schedule,
    vesting_start: candidate.start,
    unresolved,
  };
}
