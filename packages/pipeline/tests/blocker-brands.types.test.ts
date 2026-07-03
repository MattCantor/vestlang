// AC#1 — the two per-space blocker brands are mutually exclusive at the type level.
// A `DeadBlocker` (resolvesTo space) must not be assignable where a
// `StaticImpossibleBlocker` (storable space) is expected, nor the reverse, so
// neither `storable.blockers = resolvesTo.dead` nor its converse type-checks.
//
// `expectTypeOf` pins the brand relationship directly. A bare `@ts-expect-error`
// would be too coarse — it passes on ANY incidental compile error, so it couldn't
// tell "the brands are disjoint" from "I typo'd the test." These assertions are
// type-level, so they're validated by `tsc -p tsconfig.lint.json` (which the root
// `typecheck` runs and which includes `tests`). The body never executes.

import { describe, it, expectTypeOf } from "vitest";
import type { DeadBlocker, StaticImpossibleBlocker } from "@vestlang/types";

describe("blocker brands are mutually exclusive (AC#1)", () => {
  it("DeadBlocker[] does not match StaticImpossibleBlocker[]", () => {
    expectTypeOf<DeadBlocker[]>().not.toMatchTypeOf<
      StaticImpossibleBlocker[]
    >();
  });

  it("StaticImpossibleBlocker[] does not match DeadBlocker[]", () => {
    expectTypeOf<StaticImpossibleBlocker[]>().not.toMatchTypeOf<
      DeadBlocker[]
    >();
  });
});
