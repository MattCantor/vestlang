import type {
  EvaluationContext,
  ResolvedNode,
  Blocker,
  VestingNodeExpr,
  Schedule,
  ImpossibleBlocker,
  VestingNode,
  ScheduleExpr,
  SelectorTag,
} from "@vestlang/types";
import { lt } from "./time.js";
import {
  isPickedResolved,
  type PickedResolved,
  type PickReturn,
} from "./utils.js";
import { evaluateVestingNode } from "./vestingNode/index.js";

/* ------------------------
 * Types & Guards
 * ------------------------ */

function allImpossible<T>(x: PickReturn<T>[]) {
  return x.every((r) => r.type === "IMPOSSIBLE");
}

function anyImpossible<T>(x: PickReturn<T>[]) {
  return x.some((r) => r.type === "IMPOSSIBLE");
}

function collectBlockers<T>(x: PickReturn<T>[]): Blocker[] {
  const blockers: Blocker[] = [];
  for (const r of x) {
    if (r.type === "PICKED") continue;
    blockers.push(...r.blockers);
  }
  return blockers;
}

function collectImpossibleBlockers<T>(x: PickReturn<T>[]): ImpossibleBlocker[] {
  const blockers: ImpossibleBlocker[] = [];
  for (const r of x) {
    if (r.type === "IMPOSSIBLE") blockers.push(...r.blockers);
  }
  return blockers;
}

/* ------------------------
 * "Best" chooser (earlier | later)
 * ------------------------ */

function chooseBest(
  a: ResolvedNode,
  b: ResolvedNode,
  selector: SelectorTag,
): ResolvedNode {
  const bIsBetter =
    selector === "EARLIER_OF" ? lt(b.date, a.date) : lt(a.date, b.date);

  return bIsBetter ? b : a;
}

/** Reduce a non-empty array of resolved picks to the single best pick. */
function reduceBest<T>(
  resolved: PickedResolved<T>[],
  selector: SelectorTag,
): { picked: T; meta: ResolvedNode } {
  // resolved is non-empty by construction when we call this
  let best = resolved[0].meta;
  let picked = resolved[0].picked;

  resolved.forEach((r) => {
    const nextBest = chooseBest(best, r.meta, selector);
    if (nextBest === r.meta) picked = r.picked;
    best = nextBest;
  });

  return { picked, meta: best };
}

/* ------------------------
 * Unified selector for both EARLIER_OF and LATER_OF
 * ------------------------ */

/**
 * EARLIER_OF is resolved if any item resolves, else unresolved, unless all impossible
 * LATER_OF is resolved if all items resolve. If some resolve, return Picked with UnresolvedNode
 */
type SelectorPolicy = {
  selector: SelectorTag;
  selectorIsSatisfied: (candidates: PickReturn<unknown>[]) => boolean; // earlier: any resolved, later: all resolved
  partialEmit: boolean; // only true for LATER_OF
  impossibleArmPoisons: boolean; // LATER_OF is universal: one dead arm sinks the whole selector
};

const EARLIER_POLICY: SelectorPolicy = {
  selector: "EARLIER_OF",
  selectorIsSatisfied: (c) => c.some(isPickedResolved),
  partialEmit: false,
  impossibleArmPoisons: false,
};

const LATER_POLICY: SelectorPolicy = {
  selector: "LATER_OF",
  selectorIsSatisfied: (c) => c.every(isPickedResolved),
  partialEmit: true,
  impossibleArmPoisons: true,
};

/** Build the IMPOSSIBLE node a selector reports when dead arms sink it. */
function impossibleSelector<T>(
  policy: SelectorPolicy,
  candidates: PickReturn<T>[],
): PickReturn<T> {
  return {
    type: "IMPOSSIBLE",
    blockers: [
      {
        type: "IMPOSSIBLE_SELECTOR",
        selector: policy.selector,
        blockers: collectImpossibleBlockers(candidates),
      },
    ],
  };
}

function handleSelector<T extends Schedule | VestingNode>(
  candidates: PickReturn<T>[],
  policy: SelectorPolicy,
): PickReturn<T> {
  if (allImpossible(candidates)) return impossibleSelector(policy, candidates);

  // LATER_OF is universal ("the later of all of them"), so a single statically
  // dead arm means there is no "later of both" — the whole selector is dead.
  // Checked before the resolved/partial logic so it dominates any resolved or
  // pending sibling.
  if (policy.impossibleArmPoisons && anyImpossible(candidates))
    return impossibleSelector(policy, candidates);

  // EARLIER_OF is existential ("first to occur"): a dead arm can never be first,
  // so drop it and resolve over the survivors. (For LATER_OF every survivor is
  // live by the poison check above, so this filter is a no-op there.)
  const live = candidates.filter((c) => c.type !== "IMPOSSIBLE");

  const resolved = live.filter(isPickedResolved);
  const hasAnyResolved = resolved.length > 0;
  const allResolved = hasAnyResolved && resolved.length === live.length;
  const unresolved = live.length - resolved.length;

  // Resolve per policy
  if (policy.selectorIsSatisfied(live)) {
    const { picked, meta } = reduceBest(resolved, policy.selector);
    return { type: "PICKED", picked, meta };
  }

  // Partial resolution branch for LATER_OF
  if (policy.partialEmit && !allResolved && hasAnyResolved) {
    const { picked } = reduceBest(resolved, policy.selector);
    return {
      type: "PICKED",
      picked,
      meta: {
        type: "UNRESOLVED",
        blockers:
          unresolved > 1
            ? [
                {
                  type: "UNRESOLVED_SELECTOR",
                  selector: policy.selector,
                  blockers: collectBlockers(live),
                },
              ]
            : collectBlockers(live),
      },
    };
  }

  // Otherwise unresolved (aggregate blockers of non-picked)
  return {
    type: "UNRESOLVED",
    blockers: [
      {
        type: "UNRESOLVED_SELECTOR",
        selector: policy.selector,
        blockers: collectBlockers(live),
      },
    ],
  };
}

/* ------------------------
 * Public API: pickers for ScheduleExpr / VestingNodeExpr
 * ------------------------ */

export function evaluateScheduleExpr(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
): PickReturn<Schedule> {
  switch (expr.type) {
    case "SCHEDULE": {
      const res = evaluateVestingNodeExpr(expr.vesting_start, ctx);
      if (res.type === "PICKED") {
        return {
          type: res.type,
          picked: expr,
          meta: res.meta,
        };
      }
      return res;
    }

    case "SCHEDULE_EARLIER_OF": {
      const candidates = expr.items.map((item) =>
        evaluateScheduleExpr(item, ctx),
      );
      return handleSelector(candidates, EARLIER_POLICY);
    }

    case "SCHEDULE_LATER_OF": {
      const candidates = expr.items.map((item) =>
        evaluateScheduleExpr(item, ctx),
      );
      return handleSelector(candidates, LATER_POLICY);
    }
  }
}

export function evaluateVestingNodeExpr(
  expr: VestingNodeExpr,
  ctx: EvaluationContext,
): PickReturn<VestingNode> {
  switch (expr.type) {
    case "NODE": {
      const res = evaluateVestingNode(expr, ctx);

      if (res.type === "RESOLVED") {
        return { type: "PICKED", picked: expr, meta: res };
      }
      return res;
    }

    case "NODE_EARLIER_OF": {
      const candidates = expr.items.map((item) =>
        evaluateVestingNodeExpr(item, ctx),
      );
      return handleSelector(candidates, EARLIER_POLICY);
    }

    case "NODE_LATER_OF": {
      const candidates = expr.items.map((item) =>
        evaluateVestingNodeExpr(item, ctx),
      );
      return handleSelector(candidates, LATER_POLICY);
    }
  }
}
