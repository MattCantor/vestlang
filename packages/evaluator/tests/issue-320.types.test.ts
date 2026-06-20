// Issue #320 — firing-invariance carried by type, not a runtime mode check. The
// built `ResolutionContext` is a discriminated union on `mode`: the `interchange`
// arm omits `events` outright, so a firing read on it is a compile error. These are
// checked by the root `typecheck` (the test files are in the lint tsconfig); the
// bodies never run. The `@ts-expect-error` lines ARE the assertions — if a
// guarantee regresses, the directive goes unused and the build fails.
//
// We assert against the interchange arm typed DIRECTLY (via `Extract`), not via the
// production EVENT read in vestingBase.ts: that read narrows on `mode` before it
// ever touches `events`, so it can't prove the firing-blind arm lacks the field.

import { describe, it, expect } from "vitest";
import type { ResolutionContext } from "@vestlang/types";

type InterchangeContext = Extract<ResolutionContext, { mode: "interchange" }>;
type FiringContext = Extract<
  ResolutionContext,
  { mode: "resolution" | "rehydrate" }
>;

// AC#2 — a firing read in interchange mode is a compile error, proven by read.
describe("#320 AC2 — reading firings off an interchange context is a type error", () => {
  it("the interchange arm has no events field; the firing arm does", () => {
    const interchange: InterchangeContext = {
      grantDate: "2025-01-01",
      grantQuantity: 100,
      vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
      mode: "interchange",
    };
    // @ts-expect-error — the interchange arm carries no `events` field at all (TS2339)
    const blind = interchange.events;

    const firing: FiringContext = {
      grantDate: "2025-01-01",
      grantQuantity: 100,
      vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
      mode: "resolution",
      events: { ipo: "2025-03-01" },
    };
    // The firing-reading arm reads its map without complaint.
    const seen = firing.events;

    expect([interchange, blind, firing, seen]).toHaveLength(4);
  });
});

// AC#2 — a firing read in interchange mode is a compile error, proven by
// construction: an interchange context that carries `events` doesn't typecheck.
describe("#320 AC2 — constructing an interchange context with events is a type error", () => {
  it("events is an excess property on the interchange arm; it's required on the firing arm", () => {
    const bad: InterchangeContext = {
      grantDate: "2025-01-01",
      grantQuantity: 100,
      vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
      mode: "interchange",
      // @ts-expect-error — the interchange arm forbids carrying firings (surfaces as
      // excess-property TS2353; @ts-expect-error matches whichever error TS reports)
      events: { ipo: "2025-03-01" },
    };

    // The same construction on the firing arm is fine — events belongs there.
    const ok: FiringContext = {
      grantDate: "2025-01-01",
      grantQuantity: 100,
      vesting_day_of_month: "31_OR_LAST_DAY_OF_MONTH",
      mode: "rehydrate",
      events: { ipo: "2025-03-01" },
    };

    expect([bad, ok]).toHaveLength(2);
  });
});
