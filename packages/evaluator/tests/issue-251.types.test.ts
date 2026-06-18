// Issue #251 — the load-bearing type-level guarantees. These are checked by the
// root `typecheck` (the test files are in the lint tsconfig); the bodies never run.
// The `@ts-expect-error` lines ARE the assertions: if a guarantee regresses, the
// directive goes unused and the build fails.

import { describe, it, expect } from "vitest";
import type {
  AsOfContextInput,
  ResolutionContextInput,
  StoredTerms,
  VestingRuntime,
} from "@vestlang/types";
import type { PersistedArtifact } from "../src/resolve/index.js";
import {
  isPickedResolved,
  isPickedCommitted,
  pickedDate,
} from "../src/evaluate/utils.js";

type PersistedArtifactRuntime = PersistedArtifact["runtime"];

// AC#12 — `mode` is un-settable by callers: it's Omitted from both input types, so
// supplying it is a build error.
describe("#251 AC12 — mode is un-settable on the input context types", () => {
  it("ResolutionContextInput has no mode field", () => {
    const ok: ResolutionContextInput = {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 100,
    };
    const bad: ResolutionContextInput = {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 100,
      // @ts-expect-error — a caller cannot set the engine mode
      mode: "resolution",
    };
    expect([ok, bad]).toHaveLength(2);
  });

  it("AsOfContextInput has no mode field", () => {
    const bad: AsOfContextInput = {
      grantDate: "2025-01-01",
      events: {},
      grantQuantity: 100,
      asOf: "2025-06-01",
      // @ts-expect-error — a caller cannot set the engine mode
      mode: "interchange",
    };
    expect(bad).toBeDefined();
  });
});

// AC#15 — the runtime split. `StoredTerms` makes eventFirings unrepresentable; the
// persisted artifact's runtime is `StoredTerms`; the firings-bearing runtime keeps
// its slot.
describe("#251 AC15 — StoredTerms makes eventFirings unrepresentable", () => {
  it("StoredTerms admits the structural fields but not eventFirings", () => {
    const ok: StoredTerms = {
      startDate: "2025-01-01",
      grantDate: "2025-01-01",
    };
    const bad: StoredTerms = {
      startDate: "2025-01-01",
      // @ts-expect-error — a stored runtime can carry no firings
      eventFirings: [{ event_id: "ipo", date: "2025-03-01" }],
    };
    expect([ok, bad]).toHaveLength(2);
  });

  it("the persisted artifact's runtime is StoredTerms (no firings)", () => {
    const bad: PersistedArtifactRuntime = {
      grantDate: "2025-01-01",
      // @ts-expect-error — PersistedArtifact.runtime is StoredTerms
      eventFirings: [{ event_id: "ipo", date: "2025-03-01" }],
    };
    expect(bad).toBeDefined();
  });

  it("the firings-bearing VestingRuntime still carries eventFirings", () => {
    const ok: VestingRuntime = {
      startDate: "2025-01-01",
      eventFirings: [{ event_id: "ipo", date: "2025-03-01" }],
    };
    expect(ok).toBeDefined();
  });
});

// AC#13 (type part) — the committed pick is distinct: `isPickedResolved` is false
// for the COMMITTED variant, and `pickedDate` covers both RESOLVED and COMMITTED.
describe("#251 AC13 — the committed pick is a distinct variant", () => {
  it("isPickedResolved is false for COMMITTED; isPickedCommitted is true; pickedDate reads both", () => {
    const committed = {
      type: "PICKED" as const,
      picked: 1,
      meta: { type: "COMMITTED" as const, date: "2030-01-01", disclosures: [] },
    };
    const resolved = {
      type: "PICKED" as const,
      picked: 2,
      meta: { type: "RESOLVED" as const, date: "2024-06-01" },
    };
    expect(isPickedResolved(committed)).toBe(false);
    expect(isPickedCommitted(committed)).toBe(true);
    expect(pickedDate(committed)).toBe("2030-01-01");
    expect(pickedDate(resolved)).toBe("2024-06-01");
    // A non-picked arm reads undefined.
    expect(pickedDate({ type: "UNRESOLVED", blockers: [] })).toBeUndefined();
  });
});
