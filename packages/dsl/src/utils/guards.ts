import { ConstraintEnum, ExprEnum, VNodeEnum } from "../enums";
import {
  Anchor,
  TemporalConstraintOrGroup,
  TemporalConstraint,
  VestingNodeConstrained,
  Constraint,
  Selector,
  SelectorTag,
} from "../types";

export function isConstrainedAnchor(a: Anchor): a is VestingNodeConstrained {
  return (
    typeof a === "object" &&
    a !== null &&
    (a as any).type === VNodeEnum.CONSTRAINED
  );
}

export function isAnyConstraint(c: Constraint): c is TemporalConstraintOrGroup {
  return typeof c === "object" && c !== null && (c as any).type === "AnyOf";
}

export function isBaseConstraint(c: Constraint): c is TemporalConstraint {
  return (
    typeof c === "object" &&
    c !== null &&
    ((c as any).type === ConstraintEnum.AFTER ||
      (c as any).type === ConstraintEnum.BEFORE)
  );
}

export function isSelectorTag(x: unknown): x is SelectorTag {
  return x === ExprEnum.EARLIER_OF || x === ExprEnum.LATER_OF;
}

export function isSelector<T = unknown>(x: any): x is Selector<T> {
  return (
    !!x &&
    isSelectorTag(x.type) &&
    Array.isArray(x.items) &&
    x.items.length >= 2
  );
}
