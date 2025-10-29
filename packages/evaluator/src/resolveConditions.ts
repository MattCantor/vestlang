import {
  Condition,
  EvaluationContext,
  NodeMeta,
  VestingNode,
  UnsatisfiedConstraint,
  Constraint,
  OCTDate,
  Offsets,
} from "@vestlang/types";
import { addDays, addMonthsRule, eq, gt, lt } from "./time.js";

/* ------------------------
 * A Before B
 *
 * |              | B Impossible | B Unresolved | B Resolved |
 * |--------------|--------------|--------------|------------|
 * | A Impossible | Impossible   | Impossible   | Impossible |
 * | A Unresolved | Unresolved   | Unresolved   | Impossible |
 * | A Resolved   | Resolved     | Resolved     | Test       |
 *
 * A After B
 *
 * |              | B Impossible | B Unresolved | B Resolved |
 * |--------------|--------------|--------------|------------|
 * | A Impossible | Impossible   | Impossible   | Impossible |
 * | A Unresolved | Impossible   | Unresolved   | Unresolved |
 * | A Resolved   | Impossible   | Impossible   | Test       |

 * ------------------------ */

/** BEFORE/AFTER with unresolved semantics + strictness */
function compareDates(
  resSubject: NodeMeta,
  resConstraintBase: NodeMeta,
  constraint: Constraint,
): UnsatisfiedConstraint | undefined {
  function result(type: "IMPOSSIBLE" | "UNRESOLVED") {
    return { type, constraint };
  }

  if (resSubject.type === "IMPOSSIBLE") {
    return result("IMPOSSIBLE");
  }

  switch (constraint.type) {
    case "BEFORE":
      switch (resSubject.type) {
        case "UNRESOLVED":
          switch (resConstraintBase.type) {
            case "IMPOSSIBLE":
            case "UNRESOLVED":
              return result("UNRESOLVED");
            case "RESOLVED":
              return result("IMPOSSIBLE");
          }
        case "RESOLVED":
          switch (resConstraintBase.type) {
            case "IMPOSSIBLE":
            case "UNRESOLVED":
              return undefined;
            case "RESOLVED":
              const subjectDate = resSubject.date;
              const constraintBaseDate = resConstraintBase.date;
              return constraint.strict
                ? lt(subjectDate, constraintBaseDate)
                  ? undefined
                  : result("IMPOSSIBLE")
                : lt(subjectDate, constraintBaseDate!) ||
                    eq(subjectDate, constraintBaseDate)
                  ? undefined
                  : result("IMPOSSIBLE");
          }
      }

    case "AFTER":
      switch (resSubject.type) {
        case "UNRESOLVED":
          switch (resConstraintBase.type) {
            case "IMPOSSIBLE":
              return result("IMPOSSIBLE");
            case "UNRESOLVED":
            case "RESOLVED":
              return undefined;
          }
        case "RESOLVED":
          switch (resConstraintBase.type) {
            case "IMPOSSIBLE":
            case "UNRESOLVED":
              return result("IMPOSSIBLE");
            case "RESOLVED":
              const subjectDate = resSubject.date;
              const constraintBaseDate = resConstraintBase.date;
              return constraint.strict
                ? gt(subjectDate, constraintBaseDate)
                  ? undefined
                  : result("IMPOSSIBLE")
                : gt(subjectDate, constraintBaseDate) ||
                    eq(subjectDate, constraintBaseDate)
                  ? undefined
                  : result("IMPOSSIBLE");
          }
      }
  }
}

/** Resolve Node that is not a selector */
export function resolveNode(
  node: VestingNode,
  ctx: EvaluationContext,
): NodeMeta {
  // constraints first
  if (node.constraints) {
    const resolvedConstraint = evaluateCondition(node.constraints, node, ctx);
    if (resolvedConstraint)
      return {
        type: "UNRESOLVED",
        blockers: [
          {
            type: "MISSING_EVENT",
            constraints: resolvedConstraint,
          },
        ],
      };
  }
  return resolveBaseNode(node, ctx);
}

function resolveBaseNode(node: VestingNode, ctx: EvaluationContext): NodeMeta {
  switch (node.base.type) {
    case "DATE":
      return {
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
                type: "MISSING_EVENT",
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

function evaluateCondition(
  condition: Condition,
  subject: VestingNode,
  ctx: EvaluationContext,
): UnsatisfiedConstraint[] | undefined {
  switch (condition.type) {
    case "ATOM":
      const resSubject = resolveNode(subject, ctx);

      const resConstraintBase = resolveNode(condition.constraint.base, ctx);

      const compareResults = compareDates(
        resSubject,
        resConstraintBase,
        condition.constraint,
      );
      if (!compareResults) return;
      return [compareResults];

    case "AND":
      return condition.items.reduce((acc, current) => {
        const compareResults = evaluateCondition(current, subject, ctx);
        if (!compareResults) return acc;
        acc.push(...compareResults);
        return acc;
      }, [] as UnsatisfiedConstraint[]);

    case "OR":
      let anyUnblocked: boolean = false;
      const constraints: UnsatisfiedConstraint[] = [];
      for (const constraint of condition.items) {
        const compareResults = evaluateCondition(constraint, subject, ctx);
        if (!compareResults) {
          anyUnblocked = true;
          continue;
        }
        constraints.push(...compareResults);
      }
      if (anyUnblocked) return undefined;
      return constraints;
  }
}
