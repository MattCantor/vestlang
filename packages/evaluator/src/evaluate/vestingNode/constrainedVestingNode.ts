import type {
  AtomCondition,
  Blocker,
  Condition,
  ConstrainedVestingNode,
  EvaluationContext,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { evaluateVestingBase } from "./vestingBase.js";
import { evaluateConstraint } from "./constraint.js";

export function evaluateConstrainedVestingNode<T extends Condition>(
  node: ConstrainedVestingNode,
  resSubject: ResolvedNode | UnresolvedNode,
  condition: T,
  ctx: EvaluationContext,
): Blocker[] | undefined {
  switch (condition.type) {
    case "ATOM":
      const resConstraintBase = evaluateVestingBase(
        condition.constraint.base,
        ctx,
      );
      const results = evaluateConstraint(
        resSubject,
        resConstraintBase,
        node as VestingNode & { constraints: AtomCondition },
      );

      return results;
    case "AND":
      return condition.items.reduce((acc, current) => {
        const results = evaluateConstrainedVestingNode(
          {
            ...node,
            constraints: current,
          }, // only evaluate one condition at a time
          resSubject,
          current,
          ctx,
        );

        if (!results) return acc;

        acc.push(...results);
        return acc;
      }, [] as Blocker[]);
    case "OR":
      let anyUnblocked: boolean = false;
      const blockers: Blocker[] = [];
      for (const c of condition.items) {
        const results = evaluateConstrainedVestingNode(
          { ...node, constraints: c }, // only evaluate one condition at a time
          resSubject,
          c,
          ctx,
        );

        if (!results || results.length === 0) {
          anyUnblocked = true;
          continue;
        }
        blockers.push(...results);
      }

      if (anyUnblocked) return undefined;

      return blockers;
  }
}
