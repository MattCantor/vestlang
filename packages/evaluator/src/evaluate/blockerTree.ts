import type { Blocker } from "@vestlang/types";

// The single source of truth for the blocker tree's edges: a blocker's children
// are the arms of a selector, and nothing else. Add a recursive variant and this
// is the one place to teach it — every walk below inherits the new edge.
const blockerChildren = (b: Blocker): Blocker[] =>
  b.type === "UNRESOLVED_SELECTOR" || b.type === "IMPOSSIBLE_SELECTOR"
    ? b.blockers
    : [];

// Bottom-up fold: each node is handed its already-folded children. One shape
// covers the three things we do with blocker trees — render them to a string,
// rebuild them with a leaf edited, and accumulate over them (T = void).
export function foldBlocker<T>(
  b: Blocker,
  combine: (node: Blocker, children: T[]) => T,
): T {
  return combine(
    b,
    blockerChildren(b).map((c) => foldBlocker(c, combine)),
  );
}
