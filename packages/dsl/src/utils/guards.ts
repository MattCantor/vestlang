import {
  Anchor,
  AnyConstraint,
  BaseConstraint,
  ConstrainedAnchor,
  Constraint,
  Selector,
  SelectorTag,
} from "../types";

export function isConstrainedAnchor(a: Anchor): a is ConstrainedAnchor {
  return (
    typeof a === "object" && a !== null && (a as any).type === "Constrained"
  );
}

export function isAnyConstraint(c: Constraint): c is AnyConstraint {
  return typeof c === "object" && c !== null && (c as any).type === "AnyOf";
}

export function isBaseConstraint(c: Constraint): c is BaseConstraint {
  return (
    typeof c === "object" &&
    c !== null &&
    ((c as any).type === "After" || (c as any).type === "Before")
  );
}

export function isSelectorTag(x: unknown): x is SelectorTag {
  return x === "EarlierOf" || x === "LaterOf";
}

export function isSelector<T = unknown>(x: any): x is Selector<T> {
  return (
    !!x &&
    isSelectorTag(x.type) &&
    Array.isArray(x.items) &&
    x.items.length >= 2
  );
}
