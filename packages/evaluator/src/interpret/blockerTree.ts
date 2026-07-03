import type {
  Blocker,
  DeadBlocker,
  ImpossibleBlocker,
  StaticImpossibleBlocker,
  UnresolvedBlocker,
} from "@vestlang/types";
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

/* ------------------------
 * The per-space brand boundary
 * ------------------------ */
//
// These two functions are the ONLY place in the codebase that mints a per-space
// blocker brand (an eslint rule forbids the casts anywhere else). Everything
// upstream works in the unbranded `Blocker` union; the brand is applied as the
// blockers cross into a verdict.

// Split a resolves-to-space blocker list into what's still pending and what's dead.
// Routing is top-level, by whether each blocker's whole subtree is impossible —
// `isImpossibleBlocker` (an `IMPOSSIBLE_SELECTOR` carries only `ImpossibleBlocker`
// children, so it's dead all the way down; an `UNRESOLVED_SELECTOR` may hold a mixed
// list, so at least one arm is still live). NOT a recursive flatten: that would
// promote a dead arm an `EARLIER_OF` has already routed around to schedule-level
// `dead`.
export function partitionResolutionBlockers(blockers: Blocker[]): {
  pending: UnresolvedBlocker[];
  dead: DeadBlocker[];
} {
  const pending: UnresolvedBlocker[] = [];
  const dead: DeadBlocker[] = [];
  for (const b of blockers) {
    if (isImpossibleBlocker(b)) {
      dead.push(b as DeadBlocker);
    } else {
      pending.push(b);
    }
  }
  return { pending, dead };
}

// Brand the storable `impossible` arm. The verdict is firing-blind, so its
// blockers are static contradictions by construction — the cast just records that.
export const brandStatic = (
  bs: ImpossibleBlocker[],
): StaticImpossibleBlocker[] => bs as StaticImpossibleBlocker[];
