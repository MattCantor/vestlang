import type {
  Anchor,
  DateAnchor,
  TemporalPredNode,
  TwoOrMore,
} from "@vestlang/dsl";
import { invariant, NormalizerError } from "../errors.js";
import { isTwoOrMore, toTwoOrMore, isDate } from "../types/raw-ast-guards.js";

/* ------------------------
 * Types
 * ------------------------ */

export type Bound = {
  at: Anchor;
  inclusive: boolean;
};

export type StartExpr =
  | { type: "Start"; bound: Bound }
  | { type: "LaterOf"; candidates: TwoOrMore<Bound> };

export type EndExpr =
  | { type: "End"; bound: Bound }
  | { type: "EarlierOf"; candidates: TwoOrMore<Bound> };

export type Window = {
  start?: StartExpr;
  end?: EndExpr;
};

/* ------------------------
 * Windows from predicates
 * ------------------------ */

export function lowerPredicatesToWindow(preds: TemporalPredNode[]): Window {
  const startBounds: Bound[] = [];
  const endBounds: Bound[] = [];

  for (const p of preds) {
    switch (p.type) {
      case "After": {
        startBounds.push({ at: p.i, inclusive: !p.strict });
        break;
      }
      case "Before": {
        endBounds.push({ at: p.i, inclusive: !p.strict });
        break;
      }
      case "Between": {
        startBounds.push({ at: p.a, inclusive: !p.strict });
        endBounds.push({ at: p.b, inclusive: !p.strict });
        break;
      }
      default: {
        // Exhaustiveness guard (compile-time via never) can live elsewhere.
      }
    }
  }

  return {
    start: buildStartExpr(startBounds),
    end: buildEndExpr(endBounds),
  };
}

function buildStartExpr(bounds: Bound[]): StartExpr | undefined {
  if (bounds.length === 0) return undefined;
  if (bounds.length === 1)
    return {
      type: "Start",
      bound: bounds[0],
    };
  return {
    type: "LaterOf",
    candidates: toTwoOrMore(bounds),
  };
}

function buildEndExpr(bounds: Bound[]): EndExpr | undefined {
  if (bounds.length === 0) return undefined;
  if (bounds.length === 1)
    return {
      type: "End",
      bound: bounds[0],
    };
  return {
    type: "EarlierOf",
    candidates: toTwoOrMore(bounds),
  };
}
