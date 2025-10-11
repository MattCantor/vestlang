import {
  type Anchor,
  type From,
  type FromLaterOf,
  type FromEarlierOf,
  type Duration,
  type ASTExpr,
  type ASTSchedule,
  type VestingNodeConstrained,
  type VestingBaseDate,
  type VestingBaseEvent,
  type EarlierOfASTExpr,
  type LaterOfASTExpr,
  type TwoOrMore,
  VBaseEnum,
  ExprEnum,
  ConstraintEnum,
  VNodeEnum,
} from "@vestlang/dsl";

// ---- Primitive anchors
export function isDate(a: Anchor | unknown): a is VestingBaseDate {
  return !!a && typeof a === "object" && (a as any).type === VBaseEnum.DATE;
}
export function isEvent(a: Anchor | unknown): a is VestingBaseEvent {
  return !!a && typeof a === "object" && (a as any).type === VBaseEnum.EVENT;
}
export function isAnchor(x: unknown): x is Anchor {
  return isDate(x) || isEvent(x);
}

// ---- Predicates
export function isAfterConstrainedAnchor(
  a: VestingNodeConstrained | unknown,
): a is Extract<VestingNodeConstrained, { type: ConstraintEnum.AFTER }> {
  return (
    !!a && typeof a === "object" && (a as any).type === ConstraintEnum.AFTER
  );
}
export function isBeforeConstrainedAnchor(
  a: VestingNodeConstrained | unknown,
): a is Extract<VestingNodeConstrained, { type: ConstraintEnum.BEFORE }> {
  return (
    !!a && typeof a === "object" && (a as any).type === ConstraintEnum.BEFORE
  );
}

// ---- FROM terms
export function isConstrainedAnchor(
  x: From | unknown,
): x is VestingNodeConstrained {
  return (
    !!x && typeof x === "object" && (x as any).type === VNodeEnum.CONSTRAINED
  );
}
export function isEarlierOfFrom(x: From | unknown): x is FromEarlierOf {
  return (
    !!x && typeof x === "object" && (x as any).type === ExprEnum.EARLIER_OF
  );
}
export function isLaterOfFrom(x: From | unknown): x is FromLaterOf {
  return (
    !!x && typeof x === "object" && (x as any).type === ExprEnum.EARLIER_OF
  );
}

// ---- Durations & gates
export function isDuration(x: unknown): x is Duration {
  return !!x && typeof x === "object" && (x as any).type === "DURATION";
}

// ---- Exprs / Schedules
export function isSchedule(e: unknown): e is ASTSchedule {
  return !!e && typeof e === "object" && (e as any).type === ExprEnum.SINGLETON;
}
export function isEarlierOfASTExpr(e: unknown): e is EarlierOfASTExpr {
  return (
    !!e && typeof e === "object" && (e as any).type === ExprEnum.EARLIER_OF
  );
}
export function isLaterOfASTExpr(e: unknown): e is LaterOfASTExpr {
  return !!e && typeof e === "object" && (e as any).type === ExprEnum.LATER_OF;
}

// ---- Utilities

export function isTwoOrMore<T>(arr: T[]): arr is TwoOrMore<T> {
  return arr.length >= 2;
}

export function toTwoOrMore<T>(xs: T[]): TwoOrMore<T> {
  if (xs.length < 2) throw new Error("Expected at least 2 items");
  return xs as TwoOrMore<T>;
}
