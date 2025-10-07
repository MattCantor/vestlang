import type {
  Anchor,
  TwoOrMore,
  EventAnchor,
  From,
  ConstrainedAnchor,
  Constraint,
  EarlierOf,
  LaterOf,
  BareAnchor,
} from "@vestlang/dsl";
import {
  isAnchor,
  isDate,
  isEarlierOfFrom,
  isEvent,
  isLaterOfFrom,
  isConstrainedAnchor,
  isTwoOrMore,
} from "../types/raw-ast-guards.js";
import { invariant, unexpectedAst } from "../errors.js";

/* ------------------------
 * Types
 * ------------------------ */

// primitives/vestlang/VestingStart
interface BaseVestingStart {
  id: string;
  base: BareAnchor;
}

interface VestingStartBare extends BaseVestingStart {
  type: "Bare";
  constraints?: never;
}

export interface VestingStartConstrained extends BaseVestingStart {
  type: "Constrained";
  constraints: readonly Constraint[];
}

type VestingStartExpr = VestingStartBare | VestingStartConstrained;

interface EarlierOfVestingStart extends EarlierOf<VestingStart> {}

interface LaterOfVestingStart extends LaterOf<VestingStart> {}

type VestingStartOperator = EarlierOfVestingStart | LaterOfVestingStart;

export type VestingStart = VestingStartExpr | VestingStartOperator;

/* ------------------------
 * Vesting Start
 * ------------------------ */

export function normalizeFromTermOrDefault(
  from: From | null | undefined,
  path: string[],
): VestingStart {
  // Insert default when FROM is not provided
  if (!from) {
    const grant: EventAnchor = { type: "Event", value: "grantDate" };
    return makeVestingStartBare(grant);
  }

  // Otherwise normalize the FROM ast
  return normalizeFromTerm(from, path);
}

function normalizeFromTerm(from: From, path: string[]): VestingStart {
  // BareAnchor
  if (isAnchor(from)) {
    return makeVestingStartBare(from);
  }

  // Constrained Anchor
  if (isConstrainedAnchor(from)) {
    return makeVestingStartConstrained(from);
  }

  // Operators
  if (isEarlierOfFrom(from)) {
    const items = from.items.map((it, i) =>
      normalizeFromTerm(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "EarlierOf FROM requires >= 2 items",
      { items },
      path,
    );
    return {
      type: "EarlierOf",
      items: items as TwoOrMore<VestingStartExpr>,
    } satisfies EarlierOfVestingStart;
  }

  if (isLaterOfFrom(from)) {
    const items = from.items.map((it, i) =>
      normalizeFromTerm(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "LaterOf fROM requires >= 2 items",
      { items },
      path,
    );
    return {
      type: "LaterOf",
      items: items as TwoOrMore<VestingStartExpr>,
    } satisfies LaterOfVestingStart;
  }
  return unexpectedAst("Unknown FromTerm variant", { from }, path);
}

export function makeVestingStartBare(a: Anchor): VestingStart {
  if (!(isDate(a) || isEvent(a)))
    return unexpectedAst("Anchor must be Date or Event", { a });
  return {
    id: "",
    type: "Bare",
    base: a,
  };
}

export function makeVestingStartConstrained(
  a: ConstrainedAnchor,
): VestingStart {
  if (!(isDate(a.base) || isEvent(a.base)))
    return unexpectedAst("Anchor must be Date or Event", { a });

  return {
    id: "",
    type: "Constrained",
    base: a.base,
    constraints: a.constraints,
  };
}
