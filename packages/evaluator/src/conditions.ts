import {
  Condition,
  ConstraintTag,
  OCTDate,
  VestingNode,
} from "@vestlang/types";
import { lt, gt, eq } from "./time.js";
import { EvaluationContext } from "./types.js";
import { resolveConcreteNode, resolveNodeBaseDate } from "./resolve.js";

/** BEFORE/AFTER with unresolved semantics + strictness */
function compareDates(
  a: OCTDate | undefined,
  b: OCTDate | undefined,
  op: ConstraintTag,
  strict: boolean,
): boolean {
  const A = !!a;
  const B = !!b;

  if (!A && !B) return false;

  switch (op) {
    case "BEFORE":
      if (A && !B) return true;
      if (!A && B) return false;
      return strict ? lt(a!, b!) : lt(a!, b!) || eq(a!, b!);
    case "AFTER":
      if (A && !B) return false;
      if (!A && B) return false;
      return strict ? gt(a!, b!) : gt(a!, b!) || eq(a!, b!);
  }
}

/**
 * Evaluate a Condition tree with respect to a SUBJECT node.
 * - Left side (A): SUBJECT.base date (no offsets, no subject constraints)
 * - Right side (B): constraint.base node with its own constraints + offsets
 */
export function evalConditionWithSubject(
  cond: Condition,
  subject: VestingNode,
  ctx: EvaluationContext,
): boolean {
  switch (cond.type) {
    case "ATOM": {
      const aBase = resolveNodeBaseDate(
        subject,
        ctx,
        /*checkConstraints*/ false,
      );
      const bFull = resolveConcreteNode(cond.constraint.base, ctx);
      const aDate = aBase?.date;
      const bDate = bFull.state === "resolved" ? bFull.date : undefined;

      return compareDates(
        aDate,
        bDate,
        cond.constraint.type,
        cond.constraint.strict,
      );
    }
    case "AND":
      return cond.items.every((i) => evalConditionWithSubject(i, subject, ctx));
    case "OR":
      return cond.items.some((i) => evalConditionWithSubject(i, subject, ctx));
  }
}
