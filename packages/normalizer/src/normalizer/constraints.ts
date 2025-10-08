/* --- Design notes ---
 * - Constraint[] is AND.
 * - AnyOf.anyOf is OR of BaseConstraint.
 * - We only canonicalize ordering & duplicates.
 * - We never change meaning
 */

import {
  Anchor,
  AnyConstraint,
  BareAnchor,
  BaseConstraint,
  ConstrainedAnchor,
  Constraint,
  TwoOrMore,
} from "@vestlang/dsl";
import { invariant } from "../errors.js";

/* --- Stable keys --- */

function anchorKey(a: BareAnchor): string {
  // Constraints only allow BareAnchor (Date | Event)
  return a.type === "Date" ? `D|${a.value}` : `E|${a.value}`;
}

function baseConstraintKey(c: BaseConstraint): string {
  // Order key parts so comparison is stable and obvious
  const s = c.strict ? "S1" : "S0";
  return `B|${c.type}|${s}|${anchorKey(c.anchor)}`;
}

function anyOfKey(c: AnyConstraint): string {
  //  Sort member base-keys and join -> canonical OR-set identity
  const members = c.anyOf.map(baseConstraintKey).sort();
  return `A|${members.join(",")}`;
}

function constraintKey(c: Constraint): string {
  return isAnyOf(c) ? anyOfKey(c) : baseConstraintKey(c);
}

/* --- Type guards --- */

function isAnyOf(c: Constraint): c is AnyConstraint {
  return (c as any)?.type === "AnyOf";
}

function isBaseConstraint(c: Constraint): c is BaseConstraint {
  return (c as any)?.type === "Before" || (c as any)?.type === "After";
}

/* --- Comparators --- */

function compareBase(a: BaseConstraint, b: BaseConstraint): number {
  // Before < After
  const typeOrder = (t: BaseConstraint["type"]) => (t === "Before" ? 0 : 1);
  if (typeOrder(a.type) !== typeOrder(b.type)) {
    return typeOrder(a.type) - typeOrder(b.type);
  }

  // strict comes first
  if (a.strict !== b.strict) return a.strict ? -1 : 1;

  // then by anchor key
  const aKey = anchorKey(a.anchor);
  const bKey = anchorKey(b.anchor);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

function compareConstraint(a: Constraint, b: Constraint): number {
  // Bases before AnyOfs
  if (isBaseConstraint(a) && isAnyOf(b)) return -1;
  if (isAnyOf(a) && isBaseConstraint(b)) return 1;

  if (isBaseConstraint(a) && isBaseConstraint(b)) return compareBase(a, b);

  // AnyOf vs AnyOf: compare by set key
  const aKey = anyOfKey(a as AnyConstraint);
  const bKey = anyOfKey(b as AnyConstraint);
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

/* --- Canonicalization primitives --- */

function canonicalizeAnyOf(any: AnyConstraint): Constraint {
  invariant(
    Array.isArray(any.anyOf) && any.anyOf.length >= 1,
    "Invalid AST: AnyOf.anyOf must be a non-empty array.",
    { anyOf: any.anyOf },
    ["constraints", "AnyOf"],
  );

  for (const m of any.anyOf) {
    invariant(
      m && ((m as any).type === "Before" || (m as any).type === "After"),
      "Invalid AST: AnyOf.anyof must contain only BaseConstraint items (Before/After).",
      { member: m },
      ["constraints", "AnyOf", "member"],
    );
  }

  // Sort + exact dedupe
  const sorted = [...any.anyOf].sort(compareBase);
  const deduped: BaseConstraint[] = [];
  let prev = "";
  for (const bc of sorted) {
    const k = baseConstraintKey(bc);
    if (k !== prev) {
      deduped.push(bc);
      prev = k;
    }
  }

  // Collapse singletons
  if (deduped.length === 1) return deduped[0]!;
  return {
    type: "AnyOf",
    anyOf: deduped as TwoOrMore<BaseConstraint>,
  } as AnyConstraint;
}

function canonicalizeConstraint(c: Constraint): Constraint {
  return isAnyOf(c) ? canonicalizeAnyOf(c) : c;
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
  a: ConstrainedAnchor,
): ConstrainedAnchor {
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
  return (anchor as any)?.type === "Constrained"
    ? normalizeConstrainedAnchor(anchor as ConstrainedAnchor)
    : anchor;
}
