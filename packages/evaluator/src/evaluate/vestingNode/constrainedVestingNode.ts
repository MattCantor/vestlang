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
import { isImpossibleBlocker } from "../blockerTree.js";
import { evaluateVestingBase } from "./vestingBase.js";
import { evaluateConstraint } from "./constraint.js";

// Is this operand a contradiction? An operand reports impossible when it has at
// least one blocker and every one of them is a contradiction — exactly the test
// the node classifier applies one level up. We only ever ask this of a non-empty
// list (empty/undefined operands are treated as satisfied before we get here), so
// the vacuously-true `.every([])` case can't slip through.
const operandIsImpossible = (results: Blocker[]): boolean =>
  results.length > 0 && results.every(isImpossibleBlocker);

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
    case "AND": {
      // An AND holds only if every conjunct holds, so one impossible conjunct kills
      // the whole thing and the pending conjuncts beside it are moot. Collect each
      // conjunct's blockers separately; if any conjunct is a contradiction, hand back
      // only the dead conjuncts' blockers (dropping the moot pending ones) so the node
      // classifier sees an all-impossible list and calls the node impossible. With no
      // dead conjunct, every blocker is still live and they flatten together as before.
      const live: Blocker[] = [];
      const dead: Blocker[] = [];
      for (const current of condition.items) {
        const results = evaluateConstrainedVestingNode(
          {
            ...node,
            condition: current,
          }, // only evaluate one condition at a time
          resSubject,
          current,
          ctx,
        );

        if (!results || results.length === 0) continue;

        if (operandIsImpossible(results)) {
          dead.push(...results);
        } else {
          live.push(...results);
        }
      }

      return dead.length > 0 ? dead : live;
    }
    case "OR": {
      // An OR holds if any arm holds. A satisfied arm short-circuits the whole OR to
      // success. Otherwise, while any arm is still live (pending) the dead arms are
      // moot — return only the live arms so the node stays unresolved (mirrors what
      // EARLIER OF already does at the selector level). Only when every arm is dead is
      // the OR itself a contradiction, and then we return them all.
      let anyUnblocked: boolean = false;
      const live: Blocker[] = [];
      const dead: Blocker[] = [];
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

        if (operandIsImpossible(results)) {
          dead.push(...results);
        } else {
          live.push(...results);
        }
      }

      if (anyUnblocked) return undefined;

      return live.length > 0 ? live : dead;
    }
    default:
      return assertNever(condition);
  }
}
