import type {
  ASTExpr,
  FromTerm,
  QualifiedAnchor,
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
  
  if (isAnchor(node)) {
    switch(node.type) {
      case "Date":
      return { id: '', anchor: node, type: "Unqualified" }
      case "Event":
      return { id: '', anchor: node, type: "Unqualified" }
      default:
      return assertNever(node as never, "Unexpected Anchor variant in normalizer")
    }
  }
  
  if (isQualifiedAnchor(node)) {
    switch(node.base.type) {
      case 'Date':
      return {
          id: '',
          anchor: node.base,
          window: {

          }
        }
      case 'Event':
      return {
          id: '',
          anchor: node.base,
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


