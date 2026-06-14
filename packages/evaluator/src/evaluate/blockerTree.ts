import type { Blocker, ImpossibleBlocker } from "@vestlang/types";
import { assertNever } from "@vestlang/utils";

// Which blockers are contradictions (vs. things still merely pending). Driven off
// the discriminant rather than the `IMPOSSIBLE_` name prefix, so adding a blocker
// variant fails the build here until it's classified — a mislabelled tag can't
// silently fall through to "unresolved".
export const isImpossibleBlocker = (b: Blocker): b is ImpossibleBlocker => {
  switch (b.type) {
    case "IMPOSSIBLE_SELECTOR":
    case "IMPOSSIBLE_CONDITION":
      return true;
    case "EVENT_NOT_YET_OCCURRED":
    case "UNRESOLVED_SELECTOR":
    case "UNRESOLVED_CONDITION":
      return false;
    default:
      return assertNever(b);
  }
};

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
