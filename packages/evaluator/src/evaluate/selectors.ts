import type {
  ResolutionContext,
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
import { lt } from "@vestlang/core";
import {
  isPickedPartial,
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
 * LATER_OF only settles once every live arm has resolved — you can't know the
 * latest until you know them all, and its resolved arm is an *upper* bound the
 * pending siblings can only push higher, so committing early would overstate.
 *
 * EARLIER_OF has two modes:
 *   - Firing-blind (the storable interchange verdict, `commitContingent` off):
 *     never commit while any arm is pending. A single resolved arm doesn't pin the
 *     earliest, because an unfired-event sibling could still be recorded with an
 *     earlier date, and a firing-invariant answer can't lean on that absence.
 *   - Closed-world with `commitContingent` on (the live resolve): commit to the
 *     earliest *resolved* arm as a guaranteed floor. Its date is a *lower* bound on
 *     the start — any actual firing only moves the anchor earlier, so the committed
 *     projection can only understate, never over-vest. The still-pending siblings'
 *     blockers are stamped with that committed date and carried on the pick so the
 *     assumption stays disclosed.
 *
 * The two selectors also differ on a dead (impossible) arm: EARLIER_OF drops it
 * and carries on; LATER_OF lets it sink the whole selector.
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
  // When true, an EARLIER_OF may commit to its earliest resolved arm even with a
  // sibling still pending (closed-world floor). Off for the firing-blind verdict.
  commitContingent: boolean,
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
      // The latest settled arm's date is the pivot: a lower bound the pending arms
      // can only push later. This is the single origin of that value — the cliff
      // lowering reads it straight off the pick rather than re-deriving it.
      pivot: best.meta.date,
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

  // Closed-world EARLIER_OF commit: at least one arm has settled, others are still
  // pending. The earliest resolved arm is a lower bound on the start (a real firing
  // can only land earlier), so committing to it is a guaranteed vesting floor. We
  // stamp the still-pending arms' blockers with that committed date — the boundary
  // we're assuming each pending event stayed absent through — and carry them on the
  // pick so the schedule can disclose the assumption. The stamping has to happen
  // before reduceBest, which keeps only the winner's meta and drops the losers.
  if (
    policy.selector === "EARLIER_OF" &&
    commitContingent &&
    hasAnyResolved &&
    !allResolved
  ) {
    const { picked, meta } = reduceBest(resolved, policy.selector);
    const disclosures = withBoundary(collectBlockers(live), meta.date);
    return { type: "PICKED", picked, meta, disclosures };
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
  commitContingent: boolean,
): PickReturn<Extract<L, Schedule | VestingNode>> {
  if (isLeaf(expr)) return evalLeaf(expr);

  // Not a leaf, so it's a selector. Keeping the EARLIER/LATER split as a switch
  // (with no default) means a newly added selector tag is a build break here —
  // the `switch-exhaustiveness-check` tripwire that collapsing the per-layer
  // switches would otherwise have dropped. `sel.type` narrows to the concrete
  // selector tags, so the switch stays exhaustive over real union members.
  const sel = expr as unknown as SelectorOf<E>;
  const candidates = sel.items.map((item) =>
    evaluateSelectorExpr(item, isLeaf, evalLeaf, commitContingent),
  );

  switch (sel.type) {
    case "SCHEDULE_EARLIER_OF":
    case "NODE_EARLIER_OF":
      return handleSelector(candidates, EARLIER_POLICY, commitContingent);
    case "SCHEDULE_LATER_OF":
    case "NODE_LATER_OF":
      return handleSelector(candidates, LATER_POLICY, commitContingent);
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
  ctx: ResolutionContext,
): PickReturn<Schedule> {
  const commit = ctx.commitContingent === true;
  return evaluateSelectorExpr(
    expr,
    isScheduleLeaf,
    (leaf) => {
      const res = evaluateVestingNodeExpr(leaf.vesting_start, ctx);
      // Re-wrap a picked vesting start around the schedule leaf. The partial arm
      // carries a required pivot, so we have to carry it through here too — narrow
      // first, then re-emit the matching arm.
      if (isPickedPartial(res)) {
        return {
          type: "PICKED",
          picked: leaf,
          meta: res.meta,
          pivot: res.pivot,
        };
      }
      if (res.type === "PICKED") {
        // A resolved pick may be a committed EARLIER OF carrying the still-pending
        // siblings' stamped blockers; forward them so the schedule lowering can
        // route them to disclosure (absenceAssumptions + resolution.pending).
        return {
          type: "PICKED",
          picked: leaf,
          meta: res.meta,
          ...(res.disclosures ? { disclosures: res.disclosures } : {}),
        };
      }
      return res;
    },
    commit,
  );
}

const isNodeLeaf = (e: VestingNodeExpr): e is VestingNode => e.type === "NODE";

export function evaluateVestingNodeExpr(
  expr: VestingNodeExpr,
  ctx: ResolutionContext,
): PickReturn<VestingNode> {
  return evaluateSelectorExpr(
    expr,
    isNodeLeaf,
    (leaf) => {
      const res = evaluateVestingNode(leaf, ctx);
      if (res.type === "RESOLVED") {
        return { type: "PICKED", picked: leaf, meta: res };
      }
      return res;
    },
    ctx.commitContingent === true,
  );
}
