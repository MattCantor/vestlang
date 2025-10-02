import type {
  Anchor,
  TwoOrMore,
  EventAnchor,
  FromTerm,
  QualifiedAnchor,
  DateAnchor,
} from "@vestlang/dsl";
import {
  isAnchor,
  isDate,
  isEarlierOfFrom,
  isEvent,
  isLaterOfFrom,
  isQualifiedAnchor,
  isTwoOrMore,
} from "../types/raw-ast-guards.js";
import { invariant, unexpectedAst } from "../errors.js";
import { lowerPredicatesToWindow, type Window } from "./window.js";

/* ------------------------
 * Types
 * ------------------------ */

// primitives/vestlang/VestingStart
interface BaseVestingStart {
  id: string;
  type: "Qualified" | "Unqualified";
  anchor: Anchor;
}

export interface VestingStartDate extends BaseVestingStart {
  type: "Unqualified";
  anchor: DateAnchor;
  window?: never;
}

export interface VestingStartEvent extends BaseVestingStart {
  type: "Unqualified";
  anchor: EventAnchor;
  window?: never;
}

export interface VestingStartQualified extends BaseVestingStart {
  type: "Qualified";
  anchor: Anchor;
  window: Window;
}

export type VestingStart =
  | VestingStartDate
  | VestingStartEvent
  | VestingStartQualified;

// combinators over vesting starts
export interface EarlierOfVestingStart {
  id: string;
  type: "EarlierOf";
  items: TwoOrMore<VestingStartExpr>;
}

export interface LaterOfVestingStart {
  id: string;
  type: "LaterOf";
  items: TwoOrMore<VestingStartExpr>;
}

export type VestingStartExpr =
  | VestingStart
  | EarlierOfVestingStart
  | LaterOfVestingStart;

/* ------------------------
 * Vesting Start
 * ------------------------ */

export function normalizeFromTermOrDefault(
  from: FromTerm | undefined,
  path: string[],
): VestingStartExpr {
  if (!from) {
    const grant: EventAnchor = { type: "Event", value: "grantDate" };
    return makeUnqualifiedStart(grant);
  }
  return normalizeFromTerm(from, path);
}

function normalizeFromTerm(from: FromTerm, path: string[]): VestingStartExpr {
  if (isAnchor(from)) {
    return makeUnqualifiedStart(from);
  }

  if (isQualifiedAnchor(from)) {
    return makeQualifiedStart(from);
  }

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
      id: "",
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
      id: "",
      type: "LaterOf",
      items: items as TwoOrMore<VestingStartExpr>,
    } satisfies LaterOfVestingStart;
  }
  return unexpectedAst("Unknown FromTerm variant", { from }, path);
}

export function makeUnqualifiedStart(a: Anchor): VestingStart {
  if (isDate(a)) {
    return <VestingStartDate>{
      id: "",
      type: "Unqualified",
      anchor: a,
      window: undefined,
    };
  }
  if (isEvent(a)) {
    return <VestingStartEvent>{
      id: "",
      type: "Unqualified",
      anchor: a,
      window: undefined,
    };
  }
  return unexpectedAst("Anchor must be Date or Event", { a });
}

export function makeQualifiedStart(q: QualifiedAnchor): VestingStartQualified {
  const created_window = lowerPredicatesToWindow(q.predicates);
  return {
    id: "",
    type: "Qualified",
    anchor: q.base,
    window: created_window,
  };
}
