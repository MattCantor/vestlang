import type {
  AbsenceDescriptor,
  EvaluationMode,
  OCTDate,
  ResolutionContext,
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
import { lt } from "@vestlang/primitives";
import {
  isPickedCommitted,
  isPickedPartial,
  isPickedResolved,
  type PickedCommitted,
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
    // A committed inner pick (an EARLIER_OF that settled to its floor) carries the
    // absence assumptions its commit leaned on. An outer fold of the other type
    // reads only this arm's floor date, so without harvesting these here the
    // assumptions would vanish one level up (#363). A RESOLVED or partial pick has
    // no assumption to contribute, so it's skipped.
    if (isPickedCommitted(r)) {
      blockers.push(...r.meta.disclosures);
      continue;
    }
    if (r.type === "PICKED") continue;
    blockers.push(...r.blockers);
  }
  return blockers;
}

// The pending-sibling half of `collectBlockers`: harvest only the arms that are
// still open (UNRESOLVED / IMPOSSIBLE) and skip every settled arm — RESOLVED and
// COMMITTED alike. A pending sibling can still land and move a LATER_OF's max, so
// its blockers ride up unconditionally; a committed sibling's disclosures do not —
// those are gated on whether it actually won the fold (`winnerIsStrictMax`).
function collectPendingBlockers<T>(x: PickReturn<T>[]): Blocker[] {
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

// A candidate the fold treats as already settled: it has a concrete date. Both a
// fully RESOLVED pick and an EARLIER_OF that committed to its floor (COMMITTED)
// qualify — an outer selector folds over the committed inner pick's floor as if it
// were settled, so a committed inner pick doesn't re-freeze one level up. The
// committed pick's own disclosures don't ride along on this date: they're harvested
// separately by `collectBlockers` (which reads a COMMITTED arm's `meta.disclosures`)
// and stamped through the outer fold's date, so a nested committed EARLIER_OF
// consumed by an outer fold still discloses its assumed-absent siblings.
type SettledPick<T> = PickedResolved<T> | PickedCommitted<T>;

const isSettled = <T>(x: PickReturn<T>): x is SettledPick<T> =>
  isPickedResolved(x) || isPickedCommitted(x);

// Is the fold's chosen arm the UNIQUE strict max — every other settled arm strictly
// earlier than it? `reduceBest` selects with strict `lt` (`dateIsBetter`), so on a
// tie the first-written arm wins arbitrarily; gating a committed arm's disclosure on
// "it won" alone would then be order-dependent. Requiring a strict max removes that:
// a tied (or later) sibling floor already pins a LATER_OF's max, so the committed
// arm's event can never move the answer and stays silent — both tie orders alike.
const winnerIsStrictMax = <T>(
  winner: SettledPick<T>,
  settled: SettledPick<T>[],
): boolean =>
  settled.every((s) => s === winner || lt(s.meta.date, winner.meta.date));

// Pick the better of two dates for the selector: the earlier for EARLIER_OF, the
// later for LATER_OF.
const dateIsBetter = (
  candidate: OCTDate,
  incumbent: OCTDate,
  selector: SelectorTag,
): boolean =>
  selector === "EARLIER_OF"
    ? lt(candidate, incumbent)
    : lt(incumbent, candidate);

/** Reduce a non-empty array of settled picks (RESOLVED or COMMITTED) to the
 *  single best pick, its date, and the winning arm itself. Both arms of
 *  SettledPick carry `meta.date`, so a committed inner pick folds on its floor
 *  exactly like a resolved one. The winner is returned so the caller can ask
 *  whether it committed and whether it was the unique strict max before harvesting
 *  its disclosures (the materiality gate); on a tie it's the first-written arm,
 *  consistent with `bestDate`. */
function reduceBest<T>(
  settled: SettledPick<T>[],
  selector: SelectorTag,
): { picked: T; date: OCTDate; winner: SettledPick<T> } {
  // settled is non-empty by construction when we call this; every member carries
  // a date (RESOLVED or COMMITTED), so `meta.date` is always present.
  let bestDate = settled[0].meta.date;
  let picked = settled[0].picked;
  let winner = settled[0];

  for (const r of settled) {
    const date = r.meta.date;
    if (dateIsBetter(date, bestDate, selector)) {
      bestDate = date;
      picked = r.picked;
      winner = r;
    }
  }

  return { picked, date: bestDate, winner };
}

/* ------------------------
 * Unified selector for both EARLIER_OF and LATER_OF
 * ------------------------ */

/**
 * Both EARLIER_OF and LATER_OF settle straightforwardly once every live arm is
 * settled (RESOLVED, or a COMMITTED inner pick the fold reads on its floor). The
 * interesting case is a *partial* selector — some arms settled, some still pending:
 *
 *   - LATER_OF stays open. Its resolved arm is an UPPER bound; a pending sibling
 *     could land even later, so committing would over-vest. It partial-emits the
 *     known floor for the projection but keeps the meta UNRESOLVED.
 *   - EARLIER_OF, in `resolution` mode, COMMITS to its earliest resolved arm.
 *     That arm is a LOWER bound — the latest the start could possibly be — so
 *     committing to it is a guaranteed vesting floor: any real firing (future,
 *     backdated, even earlier than the date) only moves the start earlier, never
 *     later. It discloses the still-pending siblings as absence assumptions. In
 *     `interchange`/`rehydrate` mode it does NOT commit (firing-blind storage must
 *     stay invariant; reload must not fabricate a firing).
 *
 * They also differ on a dead (impossible) arm: EARLIER_OF drops it and carries on
 * (a dead arm can never be first); LATER_OF lets it sink the whole selector.
 */
type SelectorPolicy = {
  selector: SelectorTag;
  selectorIsSatisfied: (candidates: PickReturn<unknown>[]) => boolean; // all live arms settled
  partialEmit: boolean; // LATER_OF: emit the known floor while staying open
  earlierCommits: boolean; // EARLIER_OF: commit to the resolved floor (mode-gated)
  impossibleArmPoisons: boolean; // LATER_OF is universal: one dead arm sinks the whole selector
  // The relation a pending arm's disclosure guards against. A pending arm could only
  // pull an EARLIER_OF's floor *earlier* (the dangerous firing is on/before the
  // settled date) and push a LATER_OF's floor *later* (on/after). Both reduce with a
  // strict `lt` (a tie keeps the incumbent), so the settled date itself is benign —
  // exclusive either way.
  disclosure: AbsenceDescriptor;
  // Which blockers the fold carries up, given the live arms, the winning arm, and
  // every settled arm. The two policies diverge here: a LATER_OF discloses a
  // committed arm's assumptions only when that arm is the unique strict max (an
  // equal-or-later sibling already pins the max, so the committed event can't move
  // it); an EARLIER_OF stays winner-blind, because a pending arm firing earlier can
  // pull a currently-losing committed arm into the winning position. Blocker
  // harvesting reads `Blocker[]` off `.blockers` / `.meta.disclosures`, so it's
  // T-independent — `unknown` matches the `selectorIsSatisfied` pattern and the
  // call sites pass `PickReturn<T>[]` / `SettledPick<T>` by array covariance.
  harvest: (
    live: PickReturn<unknown>[],
    winner: SettledPick<unknown>,
    settled: SettledPick<unknown>[],
  ) => Blocker[];
};

const EARLIER_POLICY: SelectorPolicy = {
  selector: "EARLIER_OF",
  selectorIsSatisfied: (c) => c.every(isSettled),
  partialEmit: false,
  earlierCommits: true,
  impossibleArmPoisons: false,
  // A pending arm landing earlier only pulls the start in — the schedule re-anchors,
  // it doesn't die. So a selector watch is a `grid-shift`, never `flips-to-impossible`.
  disclosure: {
    direction: "before",
    inclusive: false,
    consequence: "grid-shift",
  },
  // Winner-blind: an EARLIER_OF takes the min, so a pending arm firing earlier can
  // pull a now-losing committed arm into the winning position — gating on the
  // current winner would wrongly silence those. Harvest every committed arm's
  // disclosures, as before (Decision 2).
  harvest: (live) => collectBlockers(live),
};

const LATER_POLICY: SelectorPolicy = {
  selector: "LATER_OF",
  selectorIsSatisfied: (c) => c.every(isSettled),
  partialEmit: true,
  earlierCommits: false,
  impossibleArmPoisons: true,
  // A pending arm landing later just pushes the floor out — same `grid-shift`.
  disclosure: {
    direction: "after",
    inclusive: false,
    consequence: "grid-shift",
  },
  // Materiality-gated: pending siblings always ride up (one could still land later
  // and move the max), but a committed arm's own disclosures only do so when that
  // arm both won the fold AND was the unique strict max. A swamped or tied committed
  // floor can never move a LATER_OF's max, so its assumed-absent event is immaterial
  // and stays silent (#473 / #363 over-disclosure).
  harvest: (live, winner, settled) => [
    ...collectPendingBlockers(live),
    ...(isPickedCommitted(winner) && winnerIsStrictMax(winner, settled)
      ? winner.meta.disclosures
      : []),
  ],
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
  mode: EvaluationMode,
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

  // Settled = RESOLVED or a COMMITTED inner pick; both fold on a concrete date.
  const settled = live.filter(isSettled);
  const hasAnySettled = settled.length > 0;
  const allSettled = hasAnySettled && settled.length === live.length;
  const pendingCount = live.length - settled.length;

  // Every live arm settled → the selector settles to the best of them. If any arm
  // was a committed inner pick (an EARLIER_OF that leaned on assumed-absent
  // siblings), those assumptions are harvested by `policy.harvest` and re-stamped
  // through this fold's date. With assumptions in hand we settle to COMMITTED so
  // they're carried up (#363); with none — the common case, e.g. all arms plain
  // RESOLVED, OR a LATER_OF whose committed arm was swamped/tied and so immaterial
  // (#473) — we settle to RESOLVED exactly as before. (Firing-blind modes never
  // commit, so the harvest is empty there and this stays RESOLVED.) Every live arm
  // is settled here, so the pending-sibling half of the harvest is empty and the
  // LATER_OF gate reduces to the winner's materiality.
  if (policy.selectorIsSatisfied(live)) {
    const { picked, date, winner } = reduceBest(settled, policy.selector);
    const disclosures = withBoundary(
      policy.harvest(live, winner, settled),
      date,
      policy.disclosure,
    );
    if (disclosures.length > 0)
      return {
        type: "PICKED",
        picked,
        meta: { type: "COMMITTED", date, disclosures },
      };
    return { type: "PICKED", picked, meta: { type: "RESOLVED", date } };
  }

  // EARLIER_OF commit: ≥1 settled arm, not all settled, and we're in the
  // closed-world `resolution` mode. The earliest settled arm is a lower bound on
  // the start (the latest it could be), so committing to it never over-vests; we
  // disclose every still-pending sibling, stamped `through` the committed date, so
  // a later/backdated firing of one of them is flagged as the thing that could
  // move the answer (earlier). Firing-blind (interchange) and reload (rehydrate)
  // must not commit — see EvaluationMode — so the branch is gated on mode here.
  if (policy.earlierCommits && hasAnySettled && mode === "resolution") {
    const { picked, date } = reduceBest(settled, policy.selector);
    // Flat, not wrapped in an UNRESOLVED_SELECTOR like the partial-LATER_OF branch
    // below: the selector committed, so the pending arms are absence assumptions on
    // a settled pick, not evidence that the selector is still unresolved.
    const disclosures = withBoundary(
      collectBlockers(live),
      date,
      policy.disclosure,
    );
    return {
      type: "PICKED",
      picked,
      meta: { type: "COMMITTED", date, disclosures },
    };
  }

  // Partial resolution branch for LATER_OF: emit the known floor for the
  // projection but keep the meta UNRESOLVED (the resolved arm is an upper bound).
  if (policy.partialEmit && !allSettled && hasAnySettled) {
    const { picked, date, winner } = reduceBest(settled, policy.selector);
    // The latest arm settled so far is the answer only as long as the arms we're
    // still waiting on don't land even later. So its date is the boundary we're
    // assuming each of those pending events stays absent through — and a firing
    // *after* it is the dangerous one (it would push the floor later). The
    // still-pending siblings ride up via `collectPendingBlockers`; a committed
    // settled arm discloses only when it's the unique strict max of the settled set
    // (it is, vacuously, when it's the only settled arm — #363 AC-5).
    const stamped = withBoundary(
      policy.harvest(live, winner, settled),
      date,
      policy.disclosure,
    );
    return {
      type: "PICKED",
      picked,
      meta: {
        type: "UNRESOLVED",
        blockers:
          pendingCount > 1
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
  mode: EvaluationMode,
): PickReturn<Extract<L, Schedule | VestingNode>> {
  if (isLeaf(expr)) return evalLeaf(expr);

  // Not a leaf, so it's a selector. Keeping the EARLIER/LATER split as a switch
  // (with no default) means a newly added selector tag is a build break here —
  // the `switch-exhaustiveness-check` tripwire that collapsing the per-layer
  // switches would otherwise have dropped. `sel.type` narrows to the concrete
  // selector tags, so the switch stays exhaustive over real union members.
  const sel = expr as unknown as SelectorOf<E>;
  const candidates = sel.items.map((item) =>
    evaluateSelectorExpr(item, isLeaf, evalLeaf, mode),
  );

  switch (sel.type) {
    case "SCHEDULE_EARLIER_OF":
    case "NODE_EARLIER_OF":
      return handleSelector(candidates, EARLIER_POLICY, mode);
    case "SCHEDULE_LATER_OF":
    case "NODE_LATER_OF":
      return handleSelector(candidates, LATER_POLICY, mode);
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
  return evaluateSelectorExpr(
    expr,
    isScheduleLeaf,
    (leaf) => {
      const res = evaluateVestingNodeExpr(leaf.vesting_start, ctx);
      // Re-wrap a picked vesting start around the schedule leaf, one arm at a time
      // so each keeps its own concrete meta (partial its UnresolvedNode, committed
      // its CommittedNode, resolved its ResolvedNode). Splitting the guards is what
      // keeps each returned `meta` narrowed to a single node type — a combined
      // `res.type === "PICKED"` branch would widen it to the union and break the
      // assignment to the PickReturn discriminated union. The non-PICKED arms
      // (UNRESOLVED / IMPOSSIBLE) pass straight through.
      if (isPickedPartial(res)) {
        return { type: "PICKED", picked: leaf, meta: res.meta };
      }
      if (isPickedCommitted(res)) {
        return { type: "PICKED", picked: leaf, meta: res.meta };
      }
      if (isPickedResolved(res)) {
        return { type: "PICKED", picked: leaf, meta: res.meta };
      }
      return res;
    },
    ctx.mode,
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
    ctx.mode,
  );
}
