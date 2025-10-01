/* ------------------------
 * Windows from predicates
 * ------------------------ */

import { Anchor, DateAnchor, TemporalPredNode } from "@vestlang/dsl";
import { isDate } from "util/types";
import { invariant, NormalizerError } from "../errors.js";
import {
  BoundCandidate,
  EndWindow,
  StartWindow,
  Window,
} from "../types/normalized.js";
import { isTwoOrMore, toTwoOrMore } from "../types/raw-ast-guards.js";

/**
 * Reduce a list of temporal predicates (AFTER / BEFORE / BETWEEN)
 * into a Window with candidate lists for start (LaterOf) and end (EarlierOf).
 * - We DO NOT discard incomparable anchors (events vs dates). We keep all candidates.
 * - If all candidates are Dates, we collapse immediately (safe).
 */
export function lowerPredicatesToWindow(preds: TemporalPredNode[]): Window {
  const startCandidates: BoundCandidate[] = [];
  const endCandidates: BoundCandidate[] = [];

  for (const p of preds) {
    switch (p.type) {
      case "After": {
        startCandidates.push({ at: p.i, inclusive: !p.strict });
        break;
      }
      case "Before": {
        endCandidates.push({ at: p.i, inclusive: !p.strict });
        break;
      }
      case "Between": {
        startCandidates.push({ at: p.a, inclusive: !p.strict });
        endCandidates.push({ at: p.b, inclusive: !p.strict });
        break;
      }
      default: {
        // Exhaustiveness guard (compile-time via never) can live elsewhere.
      }
    }
  }

  const start = makeStartWindow(startCandidates);
  const end = makeEndWindow(endCandidates);

  // Optional, non-lossy simplification: collapse only if *all* are Dates
  const simplifiedStart = maybeCollapseStartIfAllDates(start);
  const simplifiedEnd = maybeCollapseEndIfAllDates(end);

  // If both are fully dated singletons, sanity-check emptiness
  if (simplifiedStart && simplifiedEnd) {
    const s = simplifiedStart.candidates[0];
    const e = simplifiedEnd.candidates[0];
    if (isDate(s.at) && isDate(e.at)) {
      if (s.at.value > e.at.value) {
        throw new NormalizerError(
          "EMPTY_WINDOW_AFTER_RESOLVE",
          "Window normalization produced start > end",
          { start: simplifiedStart, end: simplifiedEnd },
        );
      }
      if (s.at.value === e.at.value && (!s.inclusive || !e.inclusive)) {
        throw new NormalizerError(
          "EMPTY_WINDOW_AFTER_RESOLVE",
          "Window normalization produced empty interval on equal exclusive bounds",
          { start: simplifiedStart, end: simplifiedEnd },
        );
      }
    }
  }

  return {
    start: simplifiedStart ?? start ?? undefined,
    end: simplifiedEnd ?? end ?? undefined,
  };
}

/** Build a StartWindow (LaterOf) from candidates; retain all candidates. */
function makeStartWindow(cands: BoundCandidate[]): StartWindow | undefined {
  if (cands.length === 0) return undefined;

  const candidates = toTwoOrMore(
    cands as [BoundCandidate, ...BoundCandidate[]],
  );
  invariant(
    isTwoOrMore(candidates),
    "StartWindow requires >= 1 candidate (TwoOrMore enforced)",
  );
  return { combine: "LaterOf" as const, candidates };
}

/** Build an EndWindow (EarlierOf) from candidates; retain all candidates. */
function makeEndWindow(cands: BoundCandidate[]): EndWindow | undefined {
  if (cands.length === 0) return undefined;
  const candidates = toTwoOrMore(
    cands as [BoundCandidate, ...BoundCandidate[]],
  );
  invariant(
    isTwoOrMore(candidates),
    "EndWindow requires >= 1 candidate (TwoOrMore enforced)",
  );
  return { combine: "EarlierOf" as const, candidates };
}

/** If a start window has all Date anchors, collapse to the single latest date. */
function maybeCollapseStartIfAllDates(
  w?: StartWindow,
): StartWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const latest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return acc;
    // equal date → conservative inclusivity (both must be inclusive to remain inclusive)
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  // return as a singleton encoded as TwoOrMore by duplication
  return { combine: "LaterOf" as const, candidates: [latest, latest] };
}

/** If an end window has all Date anchors, collapse to the single earliest date. */
function maybeCollapseEndIfAllDates(w?: EndWindow): EndWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const earliest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return acc;
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  return { combine: "EarlierOf" as const, candidates: [earliest, earliest] };
}

/* ------------------------
 * Bound combinators
 * ------------------------ */

/** Append a start candidate (LaterOf). */
export function pushStartCandidate(
  w: StartWindow | undefined,
  c: BoundCandidate<Anchor>,
): StartWindow {
  if (!w) return { combine: "LaterOf" as const, candidates: [c, c] }; // satisfy TwoOrMore via dup
  const next = {
    combine: "LaterOf" as const,
    candidates: [...w.candidates, c] as any,
  };
  invariant(
    isTwoOrMore(next.candidates),
    "StartWindow must keep TwoOrMore candidates",
  );
  return next;
}

/** Append an end candidate (EarlierOf). */
export function pushEndCandidate(
  w: EndWindow | undefined,
  c: BoundCandidate<Anchor>,
): EndWindow {
  if (!w) return { combine: "EarlierOf" as const, candidates: [c, c] };
  const next = {
    combine: "EarlierOf" as const,
    candidates: [...w.candidates, c] as any,
  };
  invariant(
    isTwoOrMore(next.candidates),
    "EndWindow must keep TwoOrMore candidates",
  );
  return next;
}

/** Merge two LaterOf start windows (concatenate candidates; no loss). */
export function mergeStartWindows(
  a?: StartWindow,
  b?: StartWindow,
): StartWindow | undefined {
  if (!a) return b;
  if (!b) return a;
  const merged = {
    combine: "LaterOf" as const,
    candidates: [...a.candidates, ...b.candidates] as any,
  };
  invariant(
    isTwoOrMore(merged.candidates),
    "StartWindow merge must keep TwoOrMore candidates",
  );
  return merged;
}

/** Merge two EarlierOf end windows (concatenate candidates; no loss). */
export function mergeEndWindows(
  a?: EndWindow,
  b?: EndWindow,
): EndWindow | undefined {
  if (!a) return b;
  if (!b) return a;
  const merged = {
    combine: "EarlierOf" as const,
    candidates: [...a.candidates, ...b.candidates] as any,
  };
  invariant(
    isTwoOrMore(merged.candidates),
    "EndWindow merge must keep TwoOrMore candidates",
  );
  return merged;
}

/**
 * Collapse a LaterOf start window if (and only if) all candidates are Dates.
 * Returns the original window if any candidate is an Event.
 */
export function collapseStartIfAllDates(
  w?: StartWindow,
): StartWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const latest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return acc;
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  return { combine: "LaterOf", candidates: [latest, latest] };
}

/**
 * Collapse an EarlierOf end window if (and only if) all candidates are Dates.
 * Returns the original window if any candidate is an Event.
 */
export function collapseEndIfAllDates(w?: EndWindow): EndWindow | undefined {
  if (!w) return undefined;
  if (!w.candidates.every((c) => isDate(c.at))) return w;

  const earliest = w.candidates.reduce((acc, cur) => {
    if ((cur.at as DateAnchor).value < (acc.at as DateAnchor).value) return cur;
    if ((cur.at as DateAnchor).value > (acc.at as DateAnchor).value) return acc;
    return { ...acc, inclusive: acc.inclusive && cur.inclusive };
  });

  return { combine: "EarlierOf", candidates: [earliest, earliest] };
}
