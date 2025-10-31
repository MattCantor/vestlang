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
import { resolveNode } from "./resolveConditions.js";
import { lt } from "./time.js";
import {
  isPickedResolved,
  type Picked,
  type PickedResolved,
  type PickReturn,
} from "./utils.js";

/* ------------------------
 * Types & Guards
 * ------------------------ */

function allImpossible<T>(x: PickReturn<T>[]) {
  return x.every((r) => r.type === "IMPOSSIBLE");
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
 * Unified selector for both EarlieOF/LaterOf
 * ------------------------ */

/**
 * EARLIER_OF is resolved if any item resolves, else unresolved, unless all impossible
 * LATER_OF is resolved if all items resolve. If some resolve, return Picked with UnresolvedNode
 */
type SelectorPolicy = {
  selector: SelectorTag;
  selectorIsSatisfied: (candidates: PickReturn<any>[]) => boolean; // earlier: any resolved, later: all resolved
  partialEmit: boolean; // only true for LATER_OF
};

const EARLIER_POLICY: SelectorPolicy = {
  selector: "EARLIER_OF",
  selectorIsSatisfied: (c) => c.some(isPickedResolved),
  partialEmit: false,
};

const LATER_POLICY: SelectorPolicy = {
  selector: "LATER_OF",
  selectorIsSatisfied: (c) => c.every(isPickedResolved),
  partialEmit: true,
};

function handleSelector<T extends Schedule | VestingNode>(
  candidates: PickReturn<T>[],
  policy: SelectorPolicy,
): PickReturn<T> {
  if (allImpossible(candidates))
    return {
      type: "IMPOSSIBLE",
      // blockers: collectImpossibleBlockers(candidates),
      blockers: [
        {
          type: "IMPOSSIBLE_SELECTOR",
          selector: policy.selector,
          blockers: collectImpossibleBlockers(candidates),
        },
      ],
    };

  const resolved = candidates.filter(isPickedResolved) as PickedResolved<T>[];
  const hasAnyResolved = resolved.length > 0;
  const allResolved = hasAnyResolved && resolved.length === candidates.length;

  // Resolve per policy
  if (policy.selectorIsSatisfied(candidates)) {
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
        blockers: [
          {
            type: "UNRESOLVED_SELECTOR",
            selector: policy.selector,
            blockers: collectBlockers(candidates),
          },
        ],
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
        blockers: collectBlockers(candidates),
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
  let candidates: PickReturn<Schedule>[] | undefined = undefined;
  switch (expr.type) {
    case "SINGLETON":
      const res = evaluateVestingNodeExpr(expr.vesting_start, ctx);
      if (res.type === "PICKED") {
        return {
          type: res.type,
          picked: expr as Schedule,
          meta: res.meta,
        } as Picked<Schedule>;
      }
      return res;

    case "EARLIER_OF":
      candidates = expr.items.map((item) => evaluateScheduleExpr(item, ctx));
      return handleSelector(candidates, EARLIER_POLICY);

    case "LATER_OF":
      candidates = expr.items.map((item) => evaluateScheduleExpr(item, ctx));
      return handleSelector(candidates, LATER_POLICY);
  }
}

export function evaluateVestingNodeExpr(
  expr: VestingNodeExpr,
  ctx: EvaluationContext,
): PickReturn<VestingNode> {
  let candidates: PickReturn<VestingNode>[] | undefined = undefined;
  switch (expr.type) {
    case "SINGLETON":
      const res = resolveNode(expr, ctx);
      if (res.type === "RESOLVED") {
        return { type: "PICKED", picked: expr, meta: res };
      }
      return res;

    case "EARLIER_OF":
      candidates = expr.items.map((item) => evaluateVestingNodeExpr(item, ctx));
      return handleSelector(candidates, EARLIER_POLICY);
    case "LATER_OF":
      candidates = expr.items.map((item) => evaluateVestingNodeExpr(item, ctx));
      return handleSelector(candidates, LATER_POLICY);
  }
}
