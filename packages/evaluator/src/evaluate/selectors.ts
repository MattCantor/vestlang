import type {
  EvaluationContext,
  ResolvedNode,
  Blocker,
  VestingNodeExpr,
  Schedule,
  ImpossibleBlocker,
  VestingNode,
  ScheduleExpr,
  ScheduleExprTag,
  NodeExprTag,
  Selector,
  SelectorTag,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { lt } from "./time.js";
import {
  isPickedResolved,
  type PickedResolved,
  type PickReturn,
} from "./utils.js";
import { evaluateVestingNode } from "./vestingNode/index.js";
import { withBoundary } from "./boundary.js";

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
 * Both EARLIER_OF and LATER_OF only settle once every live arm has resolved.
 * For LATER_OF that's obvious — you can't know the latest until you know them
 * all. For EARLIER_OF it's subtler: a single resolved arm doesn't pin the
 * earliest, because an unfired-event sibling could still be recorded with an
 * earlier date. So neither selector commits while any arm is still pending.
 * They differ only in how they treat a dead (impossible) arm: EARLIER_OF drops
 * it and carries on; LATER_OF lets it sink the whole selector.
 */
type SelectorPolicy = {
  selector: SelectorTag;
  selectorIsSatisfied: (candidates: PickReturn<unknown>[]) => boolean; // both: all live arms resolved
  partialEmit: boolean; // only true for LATER_OF
  impossibleArmPoisons: boolean; // LATER_OF is universal: one dead arm sinks the whole selector
};

const EARLIER_POLICY: SelectorPolicy = {
  selector: "EARLIER_OF",
  selectorIsSatisfied: (c) => c.every(isPickedResolved),
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
    const best = reduceBest(resolved, policy.selector);
    // The latest arm settled so far is the answer only as long as the arms we're
    // still waiting on don't land even later. So its date is the boundary we're
    // assuming each of those pending events stays absent through.
    const stamped = withBoundary(collectBlockers(live), best.meta.date);
    return {
      type: "PICKED",
      picked: best.picked,
      meta: {
        type: "UNRESOLVED",
        blockers:
          unresolved > 1
            ? [
                {
                  type: "UNRESOLVED_SELECTOR",
                  selector: policy.selector,
                  blockers: stamped,
                },
              ]
            : stamped,
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
 * Generic leaf-or-selector fold
 * ------------------------ */

// Every selector tag across both expression families. Concrete and finite, so a
// switch over it is what keeps the `switch-exhaustiveness-check` tripwire live:
// add a selector kind to either family's enum and this union grows, breaking the
// build until the switch in `evaluateSelectorExpr` handles it.
type AnySelectorTag = Exclude<
  ScheduleExprTag | NodeExprTag,
  "SCHEDULE" | "NODE"
>;

// A non-leaf arm is a selector: a list of same-family arms tagged EARLIER/LATER.
// `Selector<E>` exposes `items` as same-family arms; the `type` is pinned to the
// concrete selector-tag union above so the switch below can be exhaustive.
type SelectorOf<E> = Omit<Selector<E>, "type"> & { type: AnySelectorTag };

// The two layers (ScheduleExpr, VestingNodeExpr) are the same fold modulo their
// leaf: a leaf is picked by `isLeaf` and evaluated by `evalLeaf`, while every
// non-leaf is a selector whose arms fold back through here. `handleSelector` and
// the policy table are shared, so only the leaf differs between callers.
function evaluateSelectorExpr<E extends { type: string }, L extends E & object>(
  expr: E,
  isLeaf: (e: E) => e is L,
  evalLeaf: (leaf: L) => PickReturn<Extract<L, Schedule | VestingNode>>,
): PickReturn<Extract<L, Schedule | VestingNode>> {
  if (isLeaf(expr)) return evalLeaf(expr);

  // Not a leaf, so it's a selector. Keeping the EARLIER/LATER split as a switch
  // (with no default) means a newly added selector tag is a build break here —
  // the `switch-exhaustiveness-check` tripwire that collapsing the per-layer
  // switches would otherwise have dropped. `sel.type` narrows to the concrete
  // selector tags, so the switch stays exhaustive over real union members.
  const sel = expr as unknown as SelectorOf<E>;
  const candidates = sel.items.map((item) =>
    evaluateSelectorExpr(item, isLeaf, evalLeaf),
  );

  switch (sel.type) {
    case "SCHEDULE_EARLIER_OF":
    case "NODE_EARLIER_OF":
      return handleSelector(candidates, EARLIER_POLICY);
    case "SCHEDULE_LATER_OF":
    case "NODE_LATER_OF":
      return handleSelector(candidates, LATER_POLICY);
    default:
      return assertNever(sel.type);
  }
}

/* ------------------------
 * Public API: pickers for ScheduleExpr / VestingNodeExpr
 * ------------------------ */

const isScheduleLeaf = (e: ScheduleExpr): e is Schedule =>
  e.type === "SCHEDULE";

export function evaluateScheduleExpr(
  expr: ScheduleExpr,
  ctx: EvaluationContext,
): PickReturn<Schedule> {
  return evaluateSelectorExpr(expr, isScheduleLeaf, (leaf) => {
    const res = evaluateVestingNodeExpr(leaf.vesting_start, ctx);
    if (res.type === "PICKED") {
      return { type: res.type, picked: leaf, meta: res.meta };
    }
    return res;
  });
}

const isNodeLeaf = (e: VestingNodeExpr): e is VestingNode => e.type === "NODE";

export function evaluateVestingNodeExpr(
  expr: VestingNodeExpr,
  ctx: EvaluationContext,
): PickReturn<VestingNode> {
  return evaluateSelectorExpr(expr, isNodeLeaf, (leaf) => {
    const res = evaluateVestingNode(leaf, ctx);
    if (res.type === "RESOLVED") {
      return { type: "PICKED", picked: leaf, meta: res };
    }
    return res;
  });
}
