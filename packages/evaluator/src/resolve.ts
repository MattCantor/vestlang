import {
  OCTDate,
  Offsets,
  VestingNode,
  VestingNodeExpr,
} from "@vestlang/types";
import { EvaluationContext, NodeResolutionState } from "./types.js";
import { evalConditionWithSubject } from "./conditions.js";
import { addMonthsRule, addDays } from "./time.js";

/**
 * Resolve a node's BASE date (no offsets).
 * - If checkConstraints = true, node's own constraints must evaluate true, otherwise treat as unresolved/inactive accordingly.
 */
export function resolveNodeBaseDate(
  node: VestingNode,
  ctx: EvaluationContext,
  checkConstraints: boolean,
): { date: OCTDate } | undefined {
  if (checkConstraints && node.constraints) {
    if (!evalConditionWithSubject(node.constraints, node, ctx)) {
      return undefined; // inactive -> treated as unavailable base
    }
  }
  if (node.base.type === "DATE") return { date: node.base.value };
  const eventDate = ctx.events[node.base.value];
  return eventDate ? { date: eventDate } : undefined;
}

function applyOffsets(base: OCTDate, offsets: Offsets): OCTDate {
  let d = base;
  for (const o of offsets) {
    d =
      o.unit === "MONTHS"
        ? addMonthsRule(d, o.sign === "PLUS" ? o.value : -o.value)
        : addDays(d, o.sign === "PLUS" ? o.value : -o.value);
  }
  return d;
}

/** Full node resolution (constraints + base + offsets) */
export function resolveConcreteNode(
  node: VestingNode,
  ctx: EvaluationContext,
): NodeResolutionState {
  // constraints first
  if (
    node.constraints &&
    !evalConditionWithSubject(node.constraints, node, ctx)
  ) {
    return { state: "inactive" };
  }
  const base = resolveNodeBaseDate(node, ctx, /*checkConstraints*/ false);
  if (!base) return { state: "unresolved" };
  return { state: "resolved", date: applyOffsets(base.date, node.offsets) };
}

export function resolveNodeExpr(
  expr: VestingNodeExpr,
  ctx: EvaluationContext,
): NodeResolutionState {
  switch (expr.type) {
    case "BARE":
    case "CONSTRAINED":
      return resolveConcreteNode(expr, ctx);
    case "EARLIER_OF": {
      let best: OCTDate | undefined;
      let sawResolved = false;
      for (const item of expr.items) {
        const resolved = resolveNodeExpr(item, ctx);
        if (resolved.state === "inactive") continue; // ignore
        if (resolved.state === "resolved") {
          sawResolved = true;
          best = !best || resolved.date < best ? resolved.date : best;
        }
      }
      return sawResolved && best
        ? { state: "resolved", date: best }
        : { state: "unresolved" };
    }
    case "LATER_OF": {
      let latest: OCTDate | undefined;
      let any = false;
      for (const item of expr.items) {
        const resolved = resolveNodeExpr(item, ctx);
        if (resolved.state === "inactive") continue; // ignore
        if (resolved.state !== "resolved") return { state: "unresolved" }; // all must resolve
        any = true;
        latest = !latest || resolved.date > latest ? resolved.date : latest;
      }
      return any && latest
        ? { state: "resolved", date: latest }
        : { state: "unresolved" };
    }
  }
}
