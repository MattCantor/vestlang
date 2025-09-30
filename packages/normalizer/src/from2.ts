import type {
  CliffTerm,
  Expr as ASTExpr,
  Duration,
  ZeroGate,
  Schedule as ASTSchedule,
  FromTerm,
  Anchor as ASTAnchor,
  QualifiedAnchor,
  EarlierOfFrom,
  LaterOfFrom,
  DateGate,
  EventAtom,
} from "@vestlang/dsl";
import {
  isSchedule,
  isEarlierOfSchedules,
  isLaterOfSchedules,
  isQualifiedAnchor,
  isEarlierOfFrom,
  isLaterOfFrom,
  isAnchor,
  assertNever,
  isTwoOrMore,
} from "./types/raw-ast-guards.js";
import { invariant, unexpectedAst } from "./errors.js";
import { Expr, VestingStart, Window } from "./types/normalized.js";
import { Anchor, EventAnchor } from "./types/shared.js";
import { OCTDate } from "./oct-types.js";
import { DateAnchor } from "./raw-ast.js";
import { createDateAnchor, createEventAnchor } from "./helpers.js";

const DEFAULT_GRANT_ANCHOR: VestingStart = { id: '', type: "Unqualified", anchor: {
  type: "Event",
  value: "grantDate"
} } 

function normalizeExpr(e: ASTExpr): Expr {
  if (isSchedule(e)) {
    return normalizeSchedule(e);
  }

  if (isEarlierOfSchedules(e)) {
    const schedules = e.items
    if (isTwoOrMore(schedules)) {
    return { type: "EarlierOfSchedules", items: schedules.map(normalizeExpr) };
    }
  }

  if (isLaterOfSchedules(e)) {
    return { type: "LaterOfSchedules", items: e.items.map(normalizeExpr) };
  }

  // Exhaustive safeguard
  return assertNever(e as never, "Unexpected Expr variant in normalizer")
}


function normalizeFrom(node: FromTerm | null): VestingStart {
  if (!node) {
    return DEFAULT_GRANT_ANCHOR
  }

  function createWindow(anchor: QualifiedAnchor): Window {

  }

  if (isAnchor(node)) {
    switch(node.type) {
      case "Date":
      return { id: '', anchor: createDateAnchor(node), type: "Unqualified" }
      case "Event":
      return { id: '', anchor: createEventAnchor(node), type: "Unqualified" }
      default:
      return assertNever(node as never, "Unexpected Anchor variant in normalizer")
    }
  }
  
  if (isQualifiedAnchor(node)) {
    switch(node.base.type) {
      case 'Date':
      return {
          id: '',
          anchor: createDateAnchor(node.base),
          window: {

          }
        }
      case 'Event':
      return {
          id: '',
          anchor: createEventAnchor(node.base),
          window: {

          }
        }
      default:
      return assertNever(node as never, "Unexpected Qualified Anchor variant in normalizer")
    }
  }

  if (isEarlierOfFrom(node)) {
   
  }

  if (isLaterOfFrom(node)) {
  
  }

  return assertNever(node as never, "Unexpected From variant in normalizer")
}


