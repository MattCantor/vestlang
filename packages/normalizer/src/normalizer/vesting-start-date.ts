import {
  type Anchor,
  type TwoOrMore,
  type VestingBaseEvent,
  type From,
  type VestingNodeConstrained,
  type Constraint,
  type EarlierOf,
  type LaterOf,
  type VestingNodeBare,
  ExprEnum,
  VNodeEnum,
  VBaseEnum,
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
import { normalizeAnchorConstraints } from "./constraints.js";

/* ------------------------
 * Types
 * ------------------------ */

// primitives/vestlang/VestingStart
interface BaseVestingStart {
  id: string;
  base: VestingNodeBare;
}

interface VestingStartBare extends BaseVestingStart {
  type: "BARE";
  constraints?: never;
}

export interface VestingStartConstrained extends BaseVestingStart {
  type: "CONSTRAINED";
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
    const grant: VestingBaseEvent = {
      type: VBaseEnum.EVENT,
      value: "grantDate",
    };
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
      type: ExprEnum.EARLIER_OF,
      items: items as TwoOrMore<VestingStart>,
    } satisfies EarlierOfVestingStart;
  }

  if (isLaterOfFrom(from)) {
    const items = from.items.map((it, i) =>
      normalizeFromTerm(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "LaterOf FROM requires >= 2 items",
      { items },
      path,
    );
    return {
      type: ExprEnum.LATER_OF,
      items: items as TwoOrMore<VestingStart>,
    } satisfies LaterOfVestingStart;
  }
  return unexpectedAst("Unknown FromTerm variant", { from }, path);
}

export function makeVestingStartBare(a: Anchor): VestingStart {
  if (!(isDate(a) || isEvent(a)))
    return unexpectedAst("Anchor must be Date or Event", { a });
  return {
    type: VNodeEnum.BARE,
    base: a,
  };
}

export function makeVestingStartConstrained(
  a: VestingNodeConstrained,
): VestingStart {
  // sort/dedupe/singleton-collapse inside AnyOf
  a = normalizeAnchorConstraints(a) as VestingNodeConstrained;
  if (!(isDate(a.base) || isEvent(a.base)))
    return unexpectedAst("Anchor must be Date or Event", { a });

  return {
    type: VNodeEnum.CONSTRAINED,
    base: a.base,
    constraints: a.constraints,
  };
}
