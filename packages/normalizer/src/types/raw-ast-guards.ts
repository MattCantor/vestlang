import type {
  Anchor,
  From,
  FromLaterOf,
  FromEarlierOf,
  Duration,
  ASTExpr,
  ASTSchedule,
  ConstrainedAnchor,
  DateAnchor,
  EventAnchor,
  EarlierOfASTExpr,
  LaterOfASTExpr,
  TwoOrMore,
  FromOperator,
} from "@vestlang/dsl";

// ---- Primitive anchors
export function isDate(a: Anchor | unknown): a is DateAnchor {
  return !!a && typeof a === "object" && (a as any).type === "Date";
}
export function isEvent(a: Anchor | unknown): a is EventAnchor {
  return !!a && typeof a === "object" && (a as any).type === "Event";
}
export function isAnchor(x: unknown): x is Anchor {
  return isDate(x) || isEvent(x);
}

// ---- Predicates
export function isAfterConstrainedAnchor(
  a: ConstrainedAnchor | unknown,
): a is Extract<ConstrainedAnchor, { type: "After" }> {
  return !!a && typeof a === "object" && (a as any).type === "After";
}
export function isBeforeConstrainedAnchor(
  a: ConstrainedAnchor | unknown,
): a is Extract<ConstrainedAnchor, { type: "Before" }> {
  return !!a && typeof a === "object" && (a as any).type === "Before";
}

// ---- FROM terms
export function isConstrainedAnchor(x: From | unknown): x is ConstrainedAnchor {
  return !!x && typeof x === "object" && (x as any).type === "Constrained";
}
export function isEarlierOfFrom(x: From | unknown): x is FromEarlierOf {
  return !!x && typeof x === "object" && (x as any).type === "EarlierOf";
}
export function isLaterOfFrom(x: From | unknown): x is FromLaterOf {
  return !!x && typeof x === "object" && (x as any).type === "LaterOf";
}

// ---- Durations & gates
export function isDuration(x: unknown): x is Duration {
  return !!x && typeof x === "object" && (x as any).type === "Duration";
}

// ---- Exprs / Schedules
export function isSchedule(e: ASTExpr | unknown): e is ASTSchedule {
  return !!e && typeof e === "object" && (e as any).type === "Schedule";
}
export function isEarlierOfASTExpr(
  e: ASTExpr | unknown,
): e is EarlierOfASTExpr {
  return !!e && typeof e === "object" && (e as any).type === "EarlierOf";
}
export function isLaterOfASTExpr(e: ASTExpr | unknown): e is LaterOfASTExpr {
  return !!e && typeof e === "object" && (e as any).type === "LaterOf";
}

// ---- Utilities

export function isTwoOrMore<T>(arr: T[]): arr is TwoOrMore<T> {
  return arr.length >= 2;
}

export function toTwoOrMore<T>(xs: T[]): TwoOrMore<T> {
  if (xs.length < 2) throw new Error("Expected at least 2 items");
  return xs as TwoOrMore<T>;
}
