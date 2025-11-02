import type {
  EvaluationContext,
  OCTDate,
  Offsets,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { addDays, addMonthsRule, gt } from "../time.js";

export function evaluateVestingBase(
  node: VestingNode,
  ctx: EvaluationContext,
  asOf: boolean = true,
): ResolvedNode | UnresolvedNode {
  switch (node.base.type) {
    case "DATE":
      const offsetDate = applyOffsets(node.base.value, node.offsets, ctx);
      const notResolved = asOf && gt(offsetDate, ctx.asOf);
      return notResolved
        ? {
            type: "UNRESOLVED",
            blockers: [{ type: "DATE_NOT_YET_OCCURRED", date: offsetDate }],
          }
        : {
            type: "RESOLVED",
            date: applyOffsets(node.base.value, node.offsets, ctx),
          };
    case "EVENT":
      const eventDate = ctx.events[node.base.value];
      return eventDate
        ? { type: "RESOLVED", date: applyOffsets(eventDate, node.offsets, ctx) }
        : {
            type: "UNRESOLVED",
            blockers: [
              {
                type: "EVENT_NOT_YET_OCCURRED",
                event: node.base.value,
              },
            ],
          };
  }
}

function applyOffsets(
  base: OCTDate,
  offsets: Offsets,
  ctx: EvaluationContext,
): OCTDate {
  let d = base;
  for (const o of offsets) {
    d =
      o.unit === "MONTHS"
        ? addMonthsRule(d, o.sign === "PLUS" ? o.value : -o.value, ctx)
        : addDays(d, o.sign === "PLUS" ? o.value : -o.value);
  }
  return d;
}
