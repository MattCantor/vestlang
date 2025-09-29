import type { TemporalPredNode, Anchor } from "@vestlang/dsl";
import { isDate } from "./guards";
import { assertNever } from "./guards";

// ==== Canonical window used everywhere downstream ====
export interface TimeWindow {
  start?: Anchor; // undefined = negative infinite
  end?: Anchor; // undefined = positive infinity
  includeStart: boolean; // defaults to true
  includeEnd: boolean; // defaults to true
}

// ==== Lower a list of temporal predicates into a single TimeWindow ====

export function lowerTemporalPredicates(
  nodes?: TemporalPredNode[],
): TimeWindow {
  // Default = unbounded inclusive
  const base: TimeWindow = { includeStart: true, includeEnd: true };

  if (!nodes || nodes.length === 0) return base;

  const windows = nodes.map(lowerOne);
  return windows.reduce(intersectTW, base);

  function lowerOne(n: TemporalPredNode): TimeWindow {
    switch (n.type) {
      case "After":
        return { start: n.i, includeStart: !n.strict, includeEnd: true };
      case "Before":
        return { end: n.i, includeStart: true, includeEnd: !n.strict };
      case "Between":
        return {
          start: n.a,
          end: n.b,
          includeStart: !n.strict,
          includeEnd: !n.strict,
        };
      default:
        return assertNever(
          n as never,
          "Unexpected TemporalPreNode variant in lowerOne",
        );
    }
  }

  function intersectTW(a: TimeWindow, b: TimeWindow): TimeWindow {
    // later start wins; if equal, inclusivity ANDs
    let start = a.start ?? b.start;
    let includeStart = a.start
      ? a.includeStart
      : b.start
        ? b.includeStart
        : true;
    if (a.start && b.start) {
      const later = laterOfSymbolic(a.start, b.start); // structural “max” (no real time compare yet)
      start = later.pick;
      includeStart = later.tie
        ? a.includeStart && b.includeStart
        : later.pick === a.start
          ? a.includeStart
          : b.includeStart;
    }

    // earlier end wins; if equal, inclusivity ANDs
    let end = a.end ?? b.end;
    let includeEnd = a.end ? a.includeEnd : b.end ? b.includeEnd : true;
    if (a.end && b.end) {
      const earlier = earlierOfSymbolic(a.end, b.end); // structural “min”
      end = earlier.pick;
      includeEnd = earlier.tie
        ? a.includeEnd && b.includeEnd
        : earlier.pick === a.end
          ? a.includeEnd
          : b.includeEnd;
    }

    // NOTE: we do NOT validate emptiness here; that requires real-time ordering downstream.
    return { start, end, includeStart, includeEnd };
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
