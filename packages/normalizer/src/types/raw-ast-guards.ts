import type {
  Anchor,
  TemporalPredNode,
  FromTerm,
  EarlierOfFrom,
  LaterOfFrom,
  Duration,
  ASTExpr,
  ASTSchedule,
  QualifiedAnchor,
  DateAnchor,
  EventAnchor,
  EarlierOfASTSchedules,
  LaterOfASTSchedules,
  TwoOrMore,
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
export function isAfterPred(
  p: TemporalPredNode | unknown,
): p is Extract<TemporalPredNode, { type: "After" }> {
  return !!p && typeof p === "object" && (p as any).type === "After";
}
export function isBeforePred(
  p: TemporalPredNode | unknown,
): p is Extract<TemporalPredNode, { type: "Before" }> {
  return !!p && typeof p === "object" && (p as any).type === "Before";
}
export function isBetweenPred(
  p: TemporalPredNode | unknown,
): p is Extract<TemporalPredNode, { type: "Between" }> {
  return !!p && typeof p === "object" && (p as any).type === "Between";
}

// ---- FROM terms
export function isQualifiedAnchor(x: FromTerm | unknown): x is QualifiedAnchor {
  return !!x && typeof x === "object" && (x as any).type === "Qualified";
}
export function isEarlierOfFrom(x: FromTerm | unknown): x is EarlierOfFrom {
  return !!x && typeof x === "object" && (x as any).type === "EarlierOf";
}
export function isLaterOfFrom(x: FromTerm | unknown): x is LaterOfFrom {
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
export function isEarlierOfSchedules(
  e: ASTExpr | unknown,
): e is EarlierOfASTSchedules {
  return (
    !!e && typeof e === "object" && (e as any).type === "EarlierOfSchedules"
  );
}
export function isLaterOfSchedules(
  e: ASTExpr | unknown,
): e is LaterOfASTSchedules {
  return !!e && typeof e === "object" && (e as any).type === "LaterOfSchedules";
}

// ---- Utilities
export function assertNever(x: never, msg = "Unexpected object"): never {
  throw new Error(msg);
}

export function isTwoOrMore<T>(arr: T[]): arr is TwoOrMore<T> {
  return arr.length >= 2;
}

type OneOrMore<T> = [T, ...T[]];

export function toTwoOrMore<T>(xs: OneOrMore<T>): [T, T, ...T[]] {
  return (xs.length === 1 ? [xs[0], xs[0]] : xs) as [T, T, ...T[]];
}
