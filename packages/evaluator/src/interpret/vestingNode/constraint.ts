import type {
  AbsenceDescriptor,
  AtomCondition,
  Blocker,
  Constraint,
  ImpossibleBlocker,
  ImpossibleNode,
  NodeMeta,
  OCTDate,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { satisfiesRelation } from "@vestlang/primitives";
import { addMonthsExact, stepByOffsets } from "../time.js";
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

// The boundary an unfired side is measured against, ready to stamp: the date plus
// the relation it guards against. Absent when there's nothing to compare the unfired
// event to (both sides unfired), so the blockers stay bare.
interface Boundary {
  through: OCTDate;
  descriptor: AbsenceDescriptor;
}

const mergedUnresolved = (
  nodes: (UnresolvedNode | ImpossibleNode)[],
  node: VestingNode,
  boundary?: Boundary,
): Blocker[] => {
  const operandBlockers = nodes.map((n) => n.blockers).flat();
  return [
    ...(boundary
      ? withBoundary(operandBlockers, boundary.through, boundary.descriptor)
      : operandBlockers),
    { type: "UNRESOLVED_CONDITION", node },
  ];
};

// The boundary + relation an unfired gate side is held against, given which side we
// know the date of. Two shapes:
//   - subject resolved, gated event pending (the constraint base is the unfired
//     side): the dangerous firing is on the `constraint.type` side of the subject
//     date, and the gated event's own offsets fold back into that boundary
//     (negated, into the raw-event frame).
//   - gated event resolved, subject pending (the subject is the unfired side): the
//     base's date already has its offset baked in (resolved upstream), so no folding
//     — and the dangerous direction is the *complement* of `constraint.type` (the
//     subject must land on the far side of the base for the gate to fail).
// Inclusivity is the complement of the gate's own `strict` either way: a non-strict
// gate admits the boundary day (benign), a strict one excludes it (dangerous).
const gateBoundary = (
  subjectDate: OCTDate | undefined,
  baseDate: OCTDate | undefined,
  constraint: Constraint,
): Boundary | undefined => {
  const inclusive = constraint.strict;
  // The relation's own side, and its complement. Which one the disclosure takes
  // depends on whether the gated event is the constraint base or the gate's subject.
  const [direct, opposite] =
    constraint.type === "BEFORE"
      ? (["before", "after"] as const)
      : (["after", "before"] as const);
  if (subjectDate !== undefined) {
    // Fold the gated event's own offset back into the boundary a *raw* firing of it
    // flips at: `... BEFORE EVENT ipo - 6 months` holds iff `ipo - 6mo >= d`, i.e. a
    // raw `ipo >= d + 6mo`, so the disclosed boundary is the subject date shifted by
    // the negation of the event's offsets (exact step, never policy-snapped). Month-
    // end clamping can make the inverse off by a day — fine for a watch-list.
    return {
      through: stepByOffsets(
        subjectDate,
        constraint.base.offsets,
        addMonthsExact,
        true,
      ),
      // A gate that fires on the dangerous side can never be satisfied, so the grant
      // dies — not just re-anchors. That's the gate-vs-selector distinction a consumer
      // can't read off `direction` (a selector guarding the same side only shifts).
      descriptor: {
        direction: direct,
        inclusive,
        consequence: "flips-to-impossible",
      },
    };
  }
  if (baseDate !== undefined) {
    return {
      through: baseDate,
      descriptor: {
        direction: opposite,
        inclusive,
        consequence: "flips-to-impossible",
      },
    };
  }
  return undefined;
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
  // date (and the relation it guards against) is what we disclose; with neither side
  // known there's nothing to record.
  if (a.type === "UNRESOLVED" || b.type === "UNRESOLVED") {
    const pending = [a, b].filter(
      (n): n is UnresolvedNode => n.type === "UNRESOLVED",
    );
    const boundary = gateBoundary(
      a.type === "RESOLVED" ? a.date : undefined,
      b.type === "RESOLVED" ? b.date : undefined,
      constraint,
    );
    return mergedUnresolved(pending, vestingNode, boundary);
  }

  // Both dates known: run the comparison. A proviso that the two known dates
  // don't satisfy makes the gate impossible.
  if (!satisfiesRelation(constraint.type, isStrict, a.date, b.date)) {
    return [createImpossibleBlocker(vestingNode)];
  }
  return undefined;
}
