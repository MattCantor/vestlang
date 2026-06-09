import type {
  AtomCondition,
  Blocker,
  ConstraintTag,
  ImpossibleBlocker,
  ImpossibleNode,
  NodeMeta,
  OCTDate,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { assertNever } from "@vestlang/utils";
import { eq, gt, lt } from "../time.js";

/* ------------------------
 * Helpers
 * ------------------------ */

const createImpossibleBlocker = (
  n: VestingNode & { condition: AtomCondition },
): ImpossibleBlocker => ({
  type: "IMPOSSIBLE_CONDITION",
  condition: { base: n.base, offsets: n.offsets, condition: n.condition },
});

const failByRelation = (
  relation: ConstraintTag,
  isStrict: boolean,
  subject: OCTDate,
  constraintBase: OCTDate,
): boolean => {
  const isBefore = lt(subject, constraintBase);
  const isEqual = eq(subject, constraintBase);
  const isAfter = gt(subject, constraintBase);

  if (relation === "BEFORE") {
    // strict: A < B; non-strict: A <= B
    return isStrict ? !isBefore : !(isBefore || isEqual);
  }

  if (relation === "AFTER") {
    // strict: A > B; non-strict A>=B
    return isStrict ? !isAfter : !(isAfter || isEqual);
  }

  return assertNever(relation);
};

const mergedUnresolved = (
  nodes: (UnresolvedNode | ImpossibleNode)[],
  condition: Omit<VestingNode, "type">,
): Blocker[] => {
  return [
    ...nodes.map((n) => n.blockers).flat(),
    { type: "UNRESOLVED_CONDITION", condition },
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
  // hand back the operand(s) we're actually waiting on.
  if (a.type === "UNRESOLVED" || b.type === "UNRESOLVED") {
    const pending = [a, b].filter(
      (n): n is UnresolvedNode => n.type === "UNRESOLVED",
    );
    return mergedUnresolved(pending, vestingNode);
  }

  // Both dates known: run the comparison.
  if (failByRelation(constraint.type, isStrict, a.date, b.date)) {
    return [createImpossibleBlocker(vestingNode)];
  }
  return undefined;
}
