import type { Anchor, TemporalPredNode } from "@vestlang/dsl";
import { isDate, assertNever } from "./types/raw-ast-guards.js";
import { Window } from "./types/normalized.js"
import { End, Start, Range } from "./helpers.js";

function lowerOne(n: TemporalPredNode): Window {
  switch (n.type) {
    case "After":
      return Start(n.i, !n.strict);
    case "Before":
      return End(n.i, !n.strict);
    case "Between":
      return Range(n.a, !n.strict, n.b, !n.strict);
    default:
      return assertNever(n as never, "Unexpected TemporalPredNode");
  }
}

// Symbolic min/max:
// - If both Dates, we can safely order lexicographically.
// - If Events or mixed, keep behaviour deterministic by picking left
function laterOfSymbolic(a: Anchor, b: Anchor) {
  // If both Dates, pick lexicographically (safe pre-eval); if Events/mixed, pick left deterministically
  if (isDate(a) && isDate(b)) {
    if (a.value > b.value) return { pick: a as Anchor, tie: false };
    if (a.value < b.value) return { pick: b as Anchor, tie: false };
    return { pick: a as Anchor, tie: true }; // same instant
  }
  return { pick: a as Anchor, tie: false }; // stable, deterministic, no semantics implied
}
function earlierOfSymbolic(a: Anchor, b: Anchor) {
  if (isDate(a) && isDate(b)) {
    if (a.value < b.value) return { pick: a as Anchor, tie: false };
    if (a.value > b.value) return { pick: b as Anchor, tie: false };
    return { pick: a as Anchor, tie: true };
  }
  return { pick: a as Anchor, tie: false };
}


function intersectTW(a: Window, b: Window): Window {
  // later start wins; tie => AND inclusivity
  let start = a.start ?? b.start;
  if (a.start && b.start) {
    const later = laterOfSymbolic(a.start.at, b.start.at);
    start = {
      at: later.pick,
      inclusive: later.tie
        ? a.start.inclusive && b.start.inclusive
        : (later.pick === a.start.at ? a.start.inclusive : b.start.inclusive),
    };
  }

  // earlier end wins; tie => AND inclusivity
  let end = a.end ?? b.end;
  if (a.end && b.end) {
    const earlier = earlierOfSymbolic(a.end.at, b.end.at);
    end = {
      at: earlier.pick,
      inclusive: earlier.tie
        ? a.end.inclusive && b.end.inclusive
        : (earlier.pick === a.end.at ? a.end.inclusive : b.end.inclusive),
    };
  }

  return { start, end };
}

export function lowerTemporalPredicates(
  nodes?: TemporalPredNode[],
): Window {

  if (!nodes || nodes.length === 0) return {};

  const windows = nodes.map(lowerOne);
  return windows.reduce(intersectTW, {});
}
