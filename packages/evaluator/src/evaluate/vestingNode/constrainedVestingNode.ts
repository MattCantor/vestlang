import type {
  AtomCondition,
  Blocker,
  Condition,
  ConstrainedVestingNode,
  ResolutionContext,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { evaluateVestingBase } from "./vestingBase.js";
import { evaluateConstraint } from "./constraint.js";

export function evaluateConstrainedVestingNode<T extends Condition>(
  node: ConstrainedVestingNode,
  resSubject: ResolvedNode | UnresolvedNode,
  condition: T,
  ctx: ResolutionContext,
): Blocker[] | undefined {
  switch (condition.type) {
    case "ATOM": {
      // A constraint base is a BEFORE/AFTER comparison boundary, never a vesting
      // date — so its MONTHS offsets always step exact, even when it references
      // the `vestingStart` anchor a cadence cliff would snap on (the #351 case).
      // That's why the role is fixed "gate" here regardless of the base's anchor.
      const resConstraintBase = evaluateVestingBase(
        condition.constraint.base,
        ctx,
        "gate",
      );
      const results = evaluateConstraint(
        resSubject,
        resConstraintBase,
        node as VestingNode & { condition: AtomCondition },
      );

      return results;
    }
    case "AND":
      return condition.items.reduce((acc, current) => {
        const results = evaluateConstrainedVestingNode(
          {
            ...node,
            condition: current,
          }, // only evaluate one condition at a time
          resSubject,
          current,
          ctx,
        );

        if (!results) return acc;

        acc.push(...results);
        return acc;
      }, [] as Blocker[]);
    case "OR": {
      let anyUnblocked: boolean = false;
      const blockers: Blocker[] = [];
      for (const c of condition.items) {
        const results = evaluateConstrainedVestingNode(
          { ...node, condition: c }, // only evaluate one condition at a time
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
    default:
      return assertNever(condition);
  }
}
