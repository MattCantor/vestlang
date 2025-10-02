/* ------------------------
 * Cliff folding
 * ------------------------ */

import type { FromTerm, TwoOrMore } from "@vestlang/dsl";
import { invariant, unexpectedAst } from "../errors.js";
import {
  isAnchor,
  isDuration,
  isEarlierOfFrom,
  isLaterOfFrom,
  isQualifiedAnchor,
  isTwoOrMore,
} from "../types/raw-ast-guards.js";
import type { Integer } from "../types/shared.js";
import { type Periodicity, unitOfPeriodicity } from "./periodicity.js";
import {
  makeQualifiedStart,
  makeUnqualifiedStart,
  type VestingStartExpr,
} from "./vesting-start-date.js";

export function foldCliffIntoStart(
  start: VestingStartExpr,
  cliff: any | undefined,
  periodicity: Periodicity,
  path: string[],
): VestingStartExpr {
  if (!cliff) return start;

  // Time-based cliff -> Periodicity.cliff
  if (isDuration(cliff)) {
    invariant(
      unitOfPeriodicity(periodicity) === cliff.unit,
      "Cliff duration unit must match periodicity",
      { periodicity, cliff },
      path,
    );
    const n = cliff.value as Integer;
    (periodicity as any).cliff = n;
    return start;
  }

  // Anchor/qualified/combinator -> LaterOf(start, cliffExpr)
  const cliffExpr = normalizeCliffToVestingStartExpr(cliff, [...path, "cliff"]);

  return makeLaterOfPair(start, cliffExpr);
}

function normalizeCliffToVestingStartExpr(
  x: any,
  path: string[],
): VestingStartExpr {
  if (isAnchor(x)) return makeUnqualifiedStart(x);
  if (isQualifiedAnchor(x)) return makeQualifiedStart(x);

  if (isEarlierOfFrom(x)) {
    const items = x.items.map((it: FromTerm, i) =>
      normalizeCliffToVestingStartExpr(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "EarlierOf cliff requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "EarlierOf",
      items: items as TwoOrMore<VestingStartExpr>,
    };
  }

  if (isLaterOfFrom(x)) {
    const items = x.items.map((it: FromTerm, i) =>
      normalizeCliffToVestingStartExpr(it, [...path, `items[${i}]`]),
    );
    invariant(
      isTwoOrMore(items),
      "LaterOf cliff requires >= 2 items",
      { items },
      path,
    );
    return {
      id: "",
      type: "LaterOf",
      items: items as TwoOrMore<VestingStartExpr>,
    };
  }

  return unexpectedAst("Unsupported cliff variant", { x }, path);
}

function makeLaterOfPair(
  a: VestingStartExpr,
  b: VestingStartExpr,
): VestingStartExpr {
  return {
    id: "",
    type: "LaterOf",
    items: [a, b],
  };
}
