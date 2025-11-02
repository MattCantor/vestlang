import type {
  AtomCondition,
  Blocker,
  ConstraintTag,
  EvaluationContext,
  ImpossibleBlocker,
  ImpossibleNode,
  NodeMeta,
  OCTDate,
  ResolvedNode,
  UnresolvedNode,
  VestingNode,
} from "@vestlang/types";
import { eq, gt, lt } from "../time.js";

/* ------------------------
 * Helpers
 * ------------------------ */

const createImpossibleBlocker = (
  n: VestingNode & { constraints: AtomCondition },
): ImpossibleBlocker => ({
  type: "IMPOSSIBLE_CONDITION",
  condition: { base: n.base, offsets: n.offsets, constraints: n.constraints },
});

const assertNever = (x: never): never => {
  throw new Error(`Unhandled case: ${String(x)}`);
};

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

  return assertNever(relation as never);
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
 * A Before B
 *
 * |                | B can't happen | B might happen | B has happened |
 * |----------------|----------------|----------------|----------------|
 * | A might happen | Indeterminate  | Indeterminate  | False          |
 * | A has happened | True           | True           | Evaluate       |
 *
 * A After B
 *
 * |                | B can't happen | B might happen | B has happened |
 * |----------------|----------------|----------------|----------------|
 * | A might happen | False          | Indeterminate  | Indeterminate  |
 * | A has happened | False          | False          | Evaluate       |

 * ------------------------ */

/** BEFORE/AFTER with unresolved semantics + strictness */
export function evaluateConstraint(
  a: ResolvedNode | UnresolvedNode,
  b: NodeMeta,
  vestingNode: VestingNode & { constraints: AtomCondition },
  ctx: EvaluationContext,
): Blocker[] | undefined {
  console.log("resolveConstraint - resSubject:", JSON.stringify(a));
  console.log("resolveConstraint - resConstraintBase:", JSON.stringify(b));
  console.log("resolveConstraint - vestingNode:", JSON.stringify(vestingNode));
  console.log("resolveConstraint - ctx:", JSON.stringify(ctx));

  const { constraint } = vestingNode.constraints;
  const isStrict = Boolean(constraint.strict);

  // B can't happen
  if (b.type === "IMPOSSIBLE") {
    if (constraint.type == "BEFORE") {
      if (a.type === "UNRESOLVED") {
        // A might happen, B can't happen -> Indeterminate (A might still occcur)
        return mergedUnresolved([a, b], vestingNode);
      }
      // A has happened, B can't happen -> condition satisfied
      return undefined; // no blockers
    }

    // relation === "AFTER": cannot be satisified because B will never occur
    return [createImpossibleBlocker(vestingNode)];
  }

  // A and B might happen -> Indeterminate
  if (a.type === "UNRESOLVED" && b.type === "UNRESOLVED") {
    return mergedUnresolved([a, b], vestingNode);
  }

  // A has happened, B might happen
  if (a.type === "RESOLVED" && b.type === "UNRESOLVED") {
    if (constraint.type === "BEFORE") {
      // A occurred before B -> condition satisfied
      return undefined; // no blockers
    }

    // A did not occur after B -> condition not satisfied
    return [createImpossibleBlocker(vestingNode)];
  }

  // A might happen, B has happened
  if (a.type === "UNRESOLVED" && b.type === "RESOLVED") {
    if (constraint.type === "BEFORE") {
      // A did not occur before B -> condition not satisfied
      return [createImpossibleBlocker(vestingNode)];
    }

    // relation === "AFTER": indeterminate because A might occur
    return mergedUnresolved([a], vestingNode);
  }
  // A has happened, B has happened -> Evaluate
  if (a.type === "RESOLVED" && b.type === "RESOLVED") {
    const aDate = a.date;
    const bDate = b.date;

    if (failByRelation(constraint.type, isStrict, aDate, bDate)) {
      return [createImpossibleBlocker(vestingNode)];
    }

    return undefined;
  }

  return assertNever(a as never);
}
