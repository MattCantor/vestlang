import type {
  AtomCondition,
  Blocker,
  ImpossibleBlocker,
  ImpossibleNode,
  NodeMeta,
  OCTDate,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { satisfiesRelation } from "@vestlang/primitives";
import { withBoundary } from "../boundary.js";

/* ------------------------
 * Helpers
 * ------------------------ */

const createImpossibleBlocker = (
  node: VestingNode & { condition: AtomCondition },
): ImpossibleBlocker => ({
  type: "IMPOSSIBLE_CONDITION",
  node,
});

// The whole-gate variant: a gate whose date constraints are *jointly* empty (their
// windows don't overlap) has no single atom to blame, so the blocker carries the
// entire gated node. Stringification renders the full gate (AND/OR and all),
// rather than one conjunct of it.
export const createGateImpossibleBlocker = (
  node: VestingNode,
): ImpossibleBlocker => ({
  type: "IMPOSSIBLE_CONDITION",
  node,
});

const mergedUnresolved = (
  nodes: (UnresolvedNode | ImpossibleNode)[],
  node: VestingNode,
  // The date the still-pending side is being measured against, if we know one.
  // It gets stamped onto the pending-event blockers (not the condition blocker)
  // so the schedule can later disclose what it's assuming stayed absent.
  through?: OCTDate,
): Blocker[] => {
  const operandBlockers = nodes.map((n) => n.blockers).flat();
  return [
    ...(through ? withBoundary(operandBlockers, through) : operandBlockers),
    { type: "UNRESOLVED_CONDITION", node },
  ];
};

/* ------------------------
 * Deciding a BEFORE/AFTER proviso ("vest from X, so long as it lands before/
 * after Y") comes down to one rule: we can only compare two dates we actually
 * know.
 *
 * Each side is one of three things:
 *   - a known date — a literal date, or an event that has already fired;
 *   - an unfired event — we don't know its date yet, and (because an event can
 *     later be recorded with any effective date, even a backdated one) we can't
 *     assume it never happens;
 *   - an impossible operand — an event the schedule has established can never
 *     occur at all.
 *
 * Both sides known     -> compare them; the proviso holds or it doesn't.
 * Either side unfired   -> wait. Absence isn't an answer: the missing event
 *                          could still be recorded on either side of the other
 *                          date, so neither "satisfied" nor "impossible" is safe
 *                          to commit to.
 * The far side can't    -> only AFTER is decidable: you can never be after
 * happen at all            something that never occurs (impossible). BEFORE an
 *                          event that never occurs is vacuously satisfied once
 *                          our own date is known.
 * ------------------------ */

/** BEFORE/AFTER with unresolved semantics + strictness */
export function evaluateConstraint(
  a: ResolvedNode | UnresolvedNode,
  b: NodeMeta,
  vestingNode: VestingNode & { condition: AtomCondition },
): Blocker[] | undefined {
  const { constraint } = vestingNode.condition;
  const isStrict = constraint.strict;

  // The constraint base can never occur.
  if (b.type === "IMPOSSIBLE") {
    if (constraint.type === "BEFORE") {
      // "Before something that never happens" holds once our own side is known,
      // but stays pending while our side is itself an unfired event.
      return a.type === "UNRESOLVED"
        ? mergedUnresolved([a, b], vestingNode)
        : undefined;
    }
    // "After something that never happens" can't be satisfied.
    return [createImpossibleBlocker(vestingNode)];
  }

  // An unfired event on either side keeps the comparison pending — we only ever
  // hand back the operand(s) we're actually waiting on. Whichever side we do know
  // the date of is the yardstick the unfired event is being held against, so that
  // date is what we're assuming it stays absent through; with neither side known
  // there's nothing to record.
  if (a.type === "UNRESOLVED" || b.type === "UNRESOLVED") {
    const pending = [a, b].filter(
      (n): n is UnresolvedNode => n.type === "UNRESOLVED",
    );
    const knownDate =
      a.type === "RESOLVED"
        ? a.date
        : b.type === "RESOLVED"
          ? b.date
          : undefined;
    return mergedUnresolved(pending, vestingNode, knownDate);
  }

  // Both dates known: run the comparison. A proviso that the two known dates
  // don't satisfy makes the gate impossible.
  if (!satisfiesRelation(constraint.type, isStrict, a.date, b.date)) {
    return [createImpossibleBlocker(vestingNode)];
  }
  return undefined;
}
