import type { TemporalPredNode, Anchor } from "@vestlang/dsl";
import { isDate } from "./guards.js";
import { assertNever } from "./guards.js";
import { Window } from "./types/normalized.js"
// ==== Lower a list of temporal predicates into a single Window ====

export function lowerTemporalPredicates(
  nodes?: TemporalPredNode[],
): Window {

  if (!nodes || nodes.length === 0) return {};

  const windows = nodes.map(lowerOne);
  return windows.reduce(intersectTW, {});

  function lowerOne(n: TemporalPredNode): Window {
    switch (n.type) {
      case "After":
        return { start: n.i, inclusiveStart: !n.strict};
      case "Before":
        return { end: n.i, inclusiveStart: true, inclusiveEnd: !n.strict };
      case "Between":
        return {
          start: n.a,
          end: n.b,
          inclusiveStart: !n.strict,
          inclusiveEnd: !n.strict,
        };
      default:
        return assertNever(
          n as never,
          "Unexpected TemporalPreNode variant in lowerOne",
        );
    }
  }

  function intersectTW(a: Window, b: Window): Window {
    // later start wins; if equal, inclusivity ANDs
    let start = a.start ?? b.start;
    let inclusiveStart = a.start
      ? a.inclusiveStart
      : b.start
        ? b.inclusiveStart
        : true;
    if (a.start && b.start) {
      const later = laterOfSymbolic(a.start, b.start); // structural “max” (no real time compare yet)
      start = later.pick;
      inclusiveStart = later.tie
        ? a.inclusiveStart && b.inclusiveStart
        : later.pick === a.start
          ? a.inclusiveStart
          : b.inclusiveStart;
    }

    // earlier end wins; if equal, inclusivity ANDs
    let end = a.end ?? b.end;
    let inclusiveEnd = a.end ? a.inclusiveEnd : b.end ? b.inclusiveEnd : true;
    if (a.end && b.end) {
      const earlier = earlierOfSymbolic(a.end, b.end); // structural “min”
      end = earlier.pick;
      inclusiveEnd = earlier.tie
        ? a.inclusiveEnd && b.inclusiveEnd
        : earlier.pick === a.end
          ? a.inclusiveEnd
          : b.inclusiveEnd;
    }

    // NOTE: we do NOT validate emptiness here; that requires real-time ordering downstream.
    return { start, end, inclusiveStart, inclusiveEnd };
  }

  // Symbolic min/max:
  // - If both Dates, we can safely order lexicographically.
  // - If Events or mixed, keep behaviour deterministic by picking left
  function laterOfSymbolic(a: Anchor, b: Anchor) {
    // If both Dates, pick lexicographically (safe pre-eval); if Events/mixed, pick left deterministically
    if (isDate(a) && isDate(b)) {
      if (a.iso > b.iso) return { pick: a as Anchor, tie: false };
      if (a.iso < b.iso) return { pick: b as Anchor, tie: false };
      return { pick: a as Anchor, tie: true }; // same instant
    }
    return { pick: a as Anchor, tie: false }; // stable, deterministic, no semantics implied
  }
  function earlierOfSymbolic(a: Anchor, b: Anchor) {
    if (a.type === "Date" && b.type === "Date") {
      if (a.iso < b.iso) return { pick: a as Anchor, tie: false };
      if (a.iso > b.iso) return { pick: b as Anchor, tie: false };
      return { pick: a as Anchor, tie: true };
    }
    return { pick: a as Anchor, tie: false };
  }
}
