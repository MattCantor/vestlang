import {
  Condition,
  EvaluationContext,
  NodeMeta,
  VestingNode,
  OCTDate,
  Offsets,
  ConstrainedVestingNode,
  Blocker,
  ResolvedNode,
  UnresolvedNode,
  ImpossibleBlocker,
  AtomCondition,
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
  resSubject: ResolvedNode | UnresolvedNode,
  resConstraintBase: NodeMeta,
  condition: AtomCondition,
): Blocker[] | undefined {
  const impossible = (): ImpossibleBlocker => ({
    type: "IMPOSSIBLE_CONDITION",
    condition,
  });
  switch (condition.constraint.type) {
    case "BEFORE":
      switch (resSubject.type) {
        case "UNRESOLVED":
          if (resConstraintBase.type == "RESOLVED") return [impossible()];
          return resSubject.blockers;

        case "RESOLVED":
          if (resConstraintBase.type === "RESOLVED") {
            const subjectDate = resSubject.date;
            const constraintBaseDate = resConstraintBase.date;

            // The constraint fails if A not before B
            const constraintFailed = condition.constraint.strict
              ? gt(subjectDate, constraintBaseDate) ||
                eq(subjectDate, constraintBaseDate)
              : gt(subjectDate, constraintBaseDate);

            if (constraintFailed) return [impossible()];
          }
      }

    case "AFTER":
      switch (resSubject.type) {
        case "UNRESOLVED":
          if (resConstraintBase.type === "IMPOSSIBLE") return [impossible()];
          return resSubject.blockers;

        case "RESOLVED":
          switch (resConstraintBase.type) {
            case "IMPOSSIBLE":
            case "UNRESOLVED":
              return [impossible()];

            case "RESOLVED":
              const subjectDate = resSubject.date;
              const constraintBaseDate = resConstraintBase.date;

              // The constraint failed if A not after B
              const constraintFailed = condition.constraint.strict
                ? lt(subjectDate, constraintBaseDate) ||
                  eq(subjectDate, constraintBaseDate)
                : lt(subjectDate, constraintBaseDate);

              if (constraintFailed) return [impossible()];
          }
      }
  }
  return undefined;
}

function allImpossibleBlockers(x: any[]): x is ImpossibleBlocker[] {
  return (
    !!x &&
    typeof x === "object" &&
    x.every((blocker) => blocker.type.split("_")[0] === "IMPOSSIBLE")
  );
}

/** Resolve Node that is not a selector */
export function resolveNode(
  node: VestingNode,
  ctx: EvaluationContext,
  asOf: boolean = false,
): NodeMeta {
  // Resolve the vesting node base
  const resBase = resolveBaseNode(node, ctx, asOf);

  // Return the resolved vesting node base if there are no constraints
  if (node.type === "BARE") return resBase;

  // Resolve constraints
  const blockers = resolveCondition(
    resBase,
    (node as ConstrainedVestingNode).constraints,
    ctx,
  );

  // Return the resolved vesting node base if all constraints succeeded
  if (!blockers) return resBase;

  // Compile and return a new Node
  console.log(" ");
  console.log("resolveNode - blockers:", JSON.stringify(blockers));
  if (allImpossibleBlockers(blockers)) {
    return {
      type: "IMPOSSIBLE",
      blockers,
    };
  }
  return {
    type: "UNRESOLVED",
    blockers,
  };
}

function resolveBaseNode(
  node: VestingNode,
  ctx: EvaluationContext,
  asOf: boolean = false,
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

function resolveCondition(
  resSubject: ResolvedNode | UnresolvedNode,
  condition: Condition,
  ctx: EvaluationContext,
): Blocker[] | undefined {
  switch (condition.type) {
    case "ATOM":
      const resConstraintBase = resolveNode(
        condition.constraint.base,
        ctx,
        true,
      );
      return compareDates(resSubject, resConstraintBase, condition);

    case "AND":
      return condition.items.reduce((acc, condition) => {
        const results = resolveCondition(resSubject, condition, ctx);
        if (!results) return acc;
        acc.push(...results);
        return acc;
      }, [] as Blocker[]);
    case "OR":
      let anyUnblocked: boolean = false;
      const blockers: Blocker[] = [];
      for (const c of condition.items) {
        const results = resolveCondition(resSubject, c, ctx);
        if (!results) {
          anyUnblocked = true;
          continue;
        }
        blockers.push(...results);
      }
      if (anyUnblocked) return undefined;
      return blockers;
  }
}
