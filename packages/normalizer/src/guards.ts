// packages/normalizer/src/guards.ts
// Keep the normalizer readable and safe by centralizing isX(...) checks and exhaustiveness helpers
import type {
  Anchor,
  DateGate,
  EventAtom,
  TemporalPredNode,
  FromTerm,
  EarlierOfFrom,
  LaterOfFrom,
  Duration,
  ZeroGate,
  Expr,
  Schedule,
  QualifiedAnchor,
} from "@vestlang/dsl";

// ---- Primitive anchors
export function isDate(a: Anchor | unknown): a is DateGate {
  return !!a && typeof a === "object" && (a as any).type === "Date";
}
export function isEvent(a: Anchor | unknown): a is EventAtom {
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
export function isZeroGate(x: unknown): x is ZeroGate {
  return !!x && typeof x === "object" && (x as any).type === "Zero";
}

// ---- Exprs / Schedules
export function isSchedule(e: Expr | unknown): e is Schedule {
  return !!e && typeof e === "object" && (e as any).type === "Schedule";
}
export function isEarlierOfSchedules(
  e: Expr | unknown,
): e is { type: "EarlierOfSchedules"; items: Expr[] } {
  return (
    !!e && typeof e === "object" && (e as any).type === "EarlierOfSchedules"
  );
}
export function isLaterOfSchedules(
  e: Expr | unknown,
): e is { type: "LaterOfSchedules"; items: Expr[] } {
  return !!e && typeof e === "object" && (e as any).type === "LaterOfSchedules";
}

// ---- Utilities
export function assertNever(x: never, msg = "Unexpected object"): never {
  throw new Error(msg);
}
