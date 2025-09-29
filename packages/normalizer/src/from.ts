// packages/normalizer/src/from.ts
import type {
  CliffTerm,
  Expr,
  Duration,
  ZeroGate,
  Schedule,
  FromTerm,
  Anchor,
  QualifiedAnchor,
  EarlierOfFrom,
  LaterOfFrom,
} from "@vestlang/dsl";
import * as temporal from "./temporal";
import {
  isSchedule,
  isEarlierOfSchedules,
  isLaterOfSchedules,
  isQualifiedAnchor,
  isEarlierOfFrom,
  isLaterOfFrom,
  isAnchor,
  assertNever,
} from "./guards";
import { invariant, unexpectedAst } from "./errors";

// A base that can be evaluated: either a bare anchor OR a combinator node from FromTerm
export type FromBase = Anchor | EarlierOfFrom | LaterOfFrom;

// Schedule after normalization: same data + resolved window for FROM
export interface NormalizedSchedule {
  type: "Schedule";
  fromBase: FromBase | null; // The structural FROM (no predicates)
  fromWindow: temporal.TimeWindow; // the lowered window (include* flags explicit)
  over: Duration | ZeroGate;
  every: Duration | ZeroGate;
  cliff?: CliffTerm;
}

// Expr after normalization: recurse and normalize every Schedule
export type NormalizedExpr =
  | NormalizedSchedule
  | { type: "EarlierOfSchedules"; items: NormalizedExpr[] }
  | { type: "LaterOfSchedules"; items: NormalizedExpr[] };

const DEFAULT_WINDOW: temporal.TimeWindow = {
  includeStart: true,
  includeEnd: true,
};
const DEFAULT_GRANT_ANCHOR: Anchor = { type: "Event", name: "grantDate" };

// Normalize a top-level Expr tree into NormalizedExpr (attaching windows to each Schedule)
export function normalizeExpr(e: Expr): NormalizedExpr {
  if (isSchedule(e)) {
    return normalizeSchedule(e);
  }

  if (isEarlierOfSchedules(e)) {
    return { type: "EarlierOfSchedules", items: e.items.map(normalizeExpr) };
  }

  if (isLaterOfSchedules(e)) {
    return { type: "LaterOfSchedules", items: e.items.map(normalizeExpr) };
  }

  // Exhaustive safeguard in case the Expr union grows later
  return assertNever(e as never, "Unexpected Expr variant in normalizer");
}

function normalizeSchedule(s: Schedule): NormalizedSchedule {
  // Defensive shape checks
  invariant(!!s.over && !!s.every, "Schedule must include OVER and EVERY");

  const normFrom = normalizeFromTerm(s.from ?? null);

  return {
    type: "Schedule",
    fromBase: normFrom.base,
    fromWindow: normFrom.window,
    over: s.over,
    every: s.every,
    cliff: s.cliff ?? { type: "Zero" },
  };
}

type FromNorm = { base: FromBase | null; window: temporal.TimeWindow };

// Normalize a FROM term into structural base + canoncial window
export function normalizeFromTerm(node: FromTerm | null): FromNorm {
  // Default: FROM grantDate with unbounded inclusive window
  if (!node) {
    return {
      base: DEFAULT_GRANT_ANCHOR,
      window: DEFAULT_WINDOW,
    };
  }

  // Qualified anchor: extract window & base anchor
  if (isQualifiedAnchor(node)) {
    const q: QualifiedAnchor = node;
    invariant(
      Array.isArray(q.predicates),
      "QualifiedAnchor.predicates must be an array",
      { node: q },
    );
    return {
      base: q.base,
      window: temporal.lowerTemporalPredicates(q.predicates),
    };
  }

  // Combinators (EarlierOf/LaterOf) pass through unchanged; no window at this level
  if (isEarlierOfFrom(node) || isLaterOfFrom(node)) {
    return {
      base: node, // FromBase
      window: DEFAULT_WINDOW,
    };
  }

  // Bare anchor
  if (isAnchor(node)) {
    return {
      base: node,
      window: DEFAULT_WINDOW,
    };
  }

  // Anything else is an AST bug
  unexpectedAst("FromTerm must be Anchor | Qualified | EarlierOf | LaterOf", {
    node,
  });
}
