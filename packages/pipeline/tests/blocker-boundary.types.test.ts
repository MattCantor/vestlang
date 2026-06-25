// #469 — the dated EVENT_NOT_YET_OCCURRED blocker's boundary is present-together: the
// `through` date and the AbsenceDescriptor (direction/inclusive/consequence) live in
// one `boundary` sub-object whose fields are all non-optional. So a half-set boundary
// — a `through` with no descriptor, or a descriptor with no `through` — is a compile
// error, not a runtime invariant policed by an assert. These `@ts-expect-error`
// fixtures lock that negative property: each construction must fail to type-check, so
// removing the constraint would flip the test red. Validated by `tsc` (the root
// `typecheck` compiles `tests`); the body never executes.

import { describe, it } from "vitest";
import type { UnresolvedBlocker } from "@vestlang/types";

describe("#469 boundary is present-together (negative compile)", () => {
  it("a through-only boundary does not type-check", () => {
    const _throughOnly: UnresolvedBlocker = {
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
      // @ts-expect-error — `through` cannot travel without the descriptor.
      boundary: { through: "2025-01-01" },
    };
    void _throughOnly;
  });

  it("a descriptor-only boundary does not type-check", () => {
    const _descriptorOnly: UnresolvedBlocker = {
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
      // @ts-expect-error — the descriptor cannot travel without `through`.
      boundary: {
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    };
    void _descriptorOnly;
  });

  it("a fully-set boundary is accepted", () => {
    const _full: UnresolvedBlocker = {
      type: "EVENT_NOT_YET_OCCURRED",
      event: "ipo",
      boundary: {
        through: "2025-01-01",
        direction: "before",
        inclusive: false,
        consequence: "grid-shift",
      },
    };
    void _full;
  });
});
