// Issue #417 — the single forcing point that closes the "field silently dropped
// on the way to storage" seam (and #422's name-list duplication). These are
// type-level assertions: the root `typecheck` compiles the test files, but the
// bodies never run. The `@ts-expect-error` directives ARE the test — if the
// forcing point regresses, the error disappears, the directive goes unused, and
// the build fails.
//
// The MCP wire validator (the third site the set forces) lives in
// `apps/mcp-server` and carries its own `satisfies Record<keyof RuntimeBase,
// z.ZodTypeAny>` — that annotation is itself the [CI] guard for AC5, failing the
// repo typecheck if a `RuntimeBase` field loses its validator. We don't re-prove
// it here (zod isn't a dep of this package); AC1 below pins the forcing-point
// shape both sites share.

import { describe, it, expect } from "vitest";
import { RUNTIME_BASE_KEYS } from "@vestlang/types";
import type { RuntimeBase } from "@vestlang/types";

// AC1 (mandatory, primary) — the key set is object-keyed, so DROPPING a key fails
// to satisfy. This is the exact bug #417 exists to close: a subset must NOT be
// accepted. An array form (`satisfies readonly (keyof RuntimeBase)[]`) would catch
// a *stray* key but happily accept a subset, so it could never catch a missing
// field — which is why the real one is object-keyed.
describe("#417 AC1 — a key set omitting a RuntimeBase key fails to satisfy", () => {
  it("the real set covers every key; a set missing one does not", () => {
    // The shipped set, re-pinned here, must still satisfy full coverage.
    const full = {
      startDate: true,
      grantDate: true,
      vestingDayOfMonth: true,
    } satisfies Record<keyof RuntimeBase, true>;

    const dropped = {
      startDate: true,
      grantDate: true,
      // vestingDayOfMonth omitted on purpose.
      // @ts-expect-error — a key set missing a `keyof RuntimeBase` key is not a
      // `Record<keyof RuntimeBase, true>` (TS1360 — object literal does not satisfy
      // the expected type, reported on the `satisfies` line below). Drop a field
      // from `RuntimeBase` *and* from `RUNTIME_BASE_KEYS` together and this error
      // moves — but the shipped `RUNTIME_BASE_KEYS satisfies …` would then break
      // first, which is the forcing point doing its job.
    } satisfies Record<keyof RuntimeBase, true>;

    // The exported set is the one the rest of the system reads from.
    expect(Object.keys(RUNTIME_BASE_KEYS).sort()).toEqual(
      Object.keys(full).sort(),
    );
    expect(Object.keys(dropped)).toHaveLength(2);
  });
});
