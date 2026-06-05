import type { NonTemplateReason, ResolveResult } from "@vestlang/evaluator";
import type {
  Condition,
  Program,
  ScheduleExpr,
  Statement,
  VestingNodeExpr,
} from "@vestlang/types";

// The events arm of the classifier's verdict — the only shape recovery acts on.
type EventsResult = Extract<ResolveResult, { kind: "events" }>;

// Whether an events-only verdict is safe to attempt template recovery on.
//
// Recovery substitutes an inferred template for the authored program, so it's
// only sound when that template is equivalent for ALL inputs — not just the one
// projection we happened to sample. That holds exactly for firing-INVARIANT
// programs: overlapping absolute-date grids, where there's no event firing to
// vary. Anything event-anchored is firing-dependent — a template inferred from
// one firing bakes that firing in — so it's rejected here, before we ever infer.
//
// The caller has already established `result.kind === "events"` (the cheap path
// short-circuits everything else), so this only weighs the remaining conditions.
export function admitsRecovery(result: EventsResult, stmts: Program): boolean {
  // Must be the overlapping-grids reason, not an event-anchored cliff. This
  // gates on the structured `kind`, never the prose `detail`.
  if (!isOverlappingAbsoluteStarts(result.reason)) return false;

  // A non-empty, fully-resolved projection to feed the inferrer. (The events arm
  // is ResolvedInstallment[], so it's complete by construction; a pending program
  // is `unresolved`, never `events`, and is turned away before reaching here.)
  if (result.installments.length === 0) return false;

  // The load-bearing check. OVERLAPPING_ABSOLUTE_STARTS is raised by two
  // structurally different collisions: a pure two-DATE-grid overlap, and an
  // event-origin THEN chain whose segments land on one event at different dates.
  // They're indistinguishable by reason `kind` — only `detail` differs, and we
  // won't parse prose. So we go to the source: if any anchor in the authored
  // program is an EVENT, the projection is firing-dependent and we bail.
  if (hasEventBase(stmts)) return false;

  return true;
}

function isOverlappingAbsoluteStarts(reason: NonTemplateReason): boolean {
  return reason.kind === "OVERLAPPING_ABSOLUTE_STARTS";
}

// True if any vesting anchor reachable from the program is an EVENT.
//
// "Reachable" is broader than the start anchor: an EVENT can hide in a cliff, in
// a BEFORE/AFTER condition's reference node, and inside LATER OF / EARLIER OF
// selector arms — so this is a full recursive walk, not a start+cliff peek.
export function hasEventBase(program: Program): boolean {
  return program.some(statementHasEventBase);
}

function statementHasEventBase(stmt: Statement): boolean {
  // A chained tail (`vesting_start: null`) has no start of its own, but it can
  // still carry an event-gated cliff, so the same walk covers both arms.
  return scheduleExprHasEventBase(stmt.expr);
}

function scheduleExprHasEventBase(
  expr: ScheduleExpr | Statement["expr"],
): boolean {
  if (expr.type !== "SINGLETON") {
    // LATER OF / EARLIER OF over schedules — recurse the arms.
    return expr.items.some(scheduleExprHasEventBase);
  }
  const start = expr.vesting_start;
  if (start !== null && nodeExprHasEventBase(start)) return true;
  const cliff = expr.periodicity.cliff;
  return cliff !== undefined && nodeExprHasEventBase(cliff);
}

function nodeExprHasEventBase(node: VestingNodeExpr): boolean {
  if (node.type !== "SINGLETON") {
    // LATER OF / EARLIER OF over nodes — recurse the arms.
    return node.items.some(nodeExprHasEventBase);
  }
  if (node.base.type === "EVENT") return true;
  return node.condition !== undefined && conditionHasEventBase(node.condition);
}

function conditionHasEventBase(condition: Condition): boolean {
  switch (condition.type) {
    case "ATOM":
      // The constraint's reference node is itself a vesting node — descend it.
      // (This is the spot the linter's walker stops short of.)
      return nodeExprHasEventBase(condition.constraint.base);
    case "AND":
    case "OR":
      return condition.items.some(conditionHasEventBase);
  }
}
