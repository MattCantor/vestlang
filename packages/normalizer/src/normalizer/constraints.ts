/* --- Design notes ---
 * - Constraint[] is AND.
 * - AnyOf.anyOf is OR of BaseConstraint.
 * - We only canonicalize ordering & duplicates.
 * - We never change meaning
 */

import {
  Anchor,
  TemporalConstraint,
  Constraint,
  ConstraintEnum,
  TwoOrMore,
  VBaseEnum,
  VNodeEnum,
  VestingBase,
  TemporalConstraintOrGroup,
  VestingNodeConstrained,
} from "@vestlang/dsl";
import { invariant } from "../errors.js";

/* --- Stable keys --- */

function vestingBaseKey(a: VestingBase): string {
  // Constraints only allow BareAnchor (Date | Event)
  return a.type === VBaseEnum.DATE ? `D|${a.value}` : `E|${a.value}`;
}

function TemporalConstraintKey(c: TemporalConstraint): string {
  // Order key parts so comparison is stable and obvious
  const s = c.strict ? "S1" : "S0";
  return `B|${c.type}|${s}|${vestingBaseKey(c.base)}`;
}

function OrGroupKey(c: TemporalConstraintOrGroup): string {
  //  Sort member base-keys and join -> canonical OR-set identity
  const members = c.items.map(TemporalConstraintKey).sort();
  return `A|${members.join(",")}`;
}

function constraintKey(c: Constraint): string {
  return isOrGroup(c) ? OrGroupKey(c) : TemporalConstraintKey(c);
}

/* --- Type guards --- */

function isOrGroup(c: Constraint): c is TemporalConstraintOrGroup {
  return (c as any)?.type === "OR";
}

function isBaseConstraint(c: Constraint): c is TemporalConstraint {
  return (
    (c as any)?.type === ConstraintEnum.BEFORE ||
    (c as any)?.type === ConstraintEnum.AFTER
  );
}

/* --- Comparators --- */

function compareBase(a: TemporalConstraint, b: TemporalConstraint): number {
  // Before < After
  const typeOrder = (t: TemporalConstraint["type"]) =>
    t === ConstraintEnum.BEFORE ? 0 : 1;
  if (typeOrder(a.type) !== typeOrder(b.type)) {
    return typeOrder(a.type) - typeOrder(b.type);
  }

  // strict comes first
  if (a.strict !== b.strict) return a.strict ? -1 : 1;

  // then by anchor key
  const aKey = vestingBaseKey(a.base);
  const bKey = vestingBaseKey(b.base);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

function compareConstraint(a: Constraint, b: Constraint): number {
  // Bases before AnyOfs
  if (isBaseConstraint(a) && isOrGroup(b)) return -1;
  if (isOrGroup(a) && isBaseConstraint(b)) return 1;

  if (isBaseConstraint(a) && isBaseConstraint(b)) return compareBase(a, b);

  // OrGroup vs OrGroup: compare by set key
  const aKey = OrGroupKey(a as TemporalConstraintOrGroup);
  const bKey = OrGroupKey(b as TemporalConstraintOrGroup);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

/* --- Canonicalization primitives --- */

function canonicalizeOrGroup(orGroup: TemporalConstraintOrGroup): Constraint {
  invariant(
    Array.isArray(orGroup.items) && orGroup.items.length >= 1,
    "Invalid AST: AnyOf.anyOf must be a non-empty array.",
    { anyOf: orGroup.items },
    ["constraints", "AnyOf"],
  );

  for (const m of orGroup.items) {
    invariant(
      m &&
        ((m as any).type === ConstraintEnum.BEFORE ||
          (m as any).type === ConstraintEnum.AFTER),
      "Invalid AST: AnyOf.anyof must contain only BaseConstraint items (Before/After).",
      { member: m },
      ["constraints", "AnyOf", "member"],
    );
  }

  // Sort + exact dedupe
  const sorted = [...orGroup.items].sort(compareBase);
  const deduped: Constraint[] = [];
  let prev = "";
  for (const bc of sorted) {
    const k = TemporalConstraintKey(bc);
    if (k !== prev) {
      deduped.push(bc);
      prev = k;
    }
  }

  // Collapse singletons
  if (deduped.length === 1) return deduped[0]!;
  return {
    type: "OR",
    items: deduped as TwoOrMore<Constraint>,
  } as TemporalConstraintOrGroup;
}

function canonicalizeConstraint(c: Constraint): Constraint {
  return isOrGroup(c) ? canonicalizeOrGroup(c) : c;
}

/* --- Public API --- */

export function canonicalizeConstraints(list: Constraint[]): Constraint[] {
  // Canonicalize each member
  const canon = list.map(canonicalizeConstraint);

  // Sort AND list
  canon.sort(compareConstraint);

  // dedupe across the AND list
  const out: Constraint[] = [];
  let prev = "";
  for (const c of canon) {
    const k = constraintKey(c);
    if (k !== prev) {
      out.push(c);
      prev = k;
    }
  }
  return out;
}

export function normalizeConstrainedAnchor(
  a: VestingNodeConstrained,
): VestingNodeConstrained {
  invariant(
    Array.isArray(a.constraints),
    "Invalid AST: constraints must be an array.",
    { a },
    ["constraints"],
  );
  const constraints = canonicalizeConstraints(a.constraints);
  return constraints === a.constraints
    ? a
    : {
        ...a,
        constraints,
      };
}

export function normalizeAnchorConstraints(anchor: Anchor): Anchor {
  return (anchor as any)?.type === VNodeEnum.CONSTRAINED
    ? normalizeConstrainedAnchor(anchor as VestingNodeConstrained)
    : anchor;
}
