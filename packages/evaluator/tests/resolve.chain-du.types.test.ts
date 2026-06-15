// AC#5 — the `chain` role DU makes two old bugs unrepresentable: an `origin` on a
// head, and a dated `tail` with no `origin`. `StmtResolution.chain` is one of
// three arms — `{ role: "head" }`, `{ role: "tail"; origin }`, `{ role:
// "pending-tail" }` — so origin lives only where a date is known.
//
// The `@ts-expect-error` lines are the assertions: if the DU ever regresses to a
// shape that admits those combinations, the directives go unused and the build
// fails. The valid fixtures below compile on their own, so a typo in the type
// can't make the whole test pass vacuously. These are type-level checks, run by
// the root `typecheck` (`tsc --noEmit -p tsconfig.lint.json`, which includes the
// test files); the body never executes.
//
// `StmtResolution` is imported by relative path on purpose — it stays unexported
// from the evaluator barrel, so the public surface doesn't widen.

import { describe, it, expect } from "vitest";
import type { StmtResolution } from "../src/resolve/lower.js";

// A minimal valid record, reused below so each case differs only in `chain`.
const base = {
  percentage: { numerator: 1, denominator: 1 },
  periodicity: { type: "MONTHS", length: 1, occurrences: 12 },
  start: { state: "RESOLVED", date: "2025-01-01", base: { type: "DATE" } },
  cliff: { state: "NONE" },
} as const;

describe("StmtResolution.chain role DU (AC#5)", () => {
  it("rejects an origin on a head", () => {
    const bad: StmtResolution = {
      ...base,
      // @ts-expect-error — a head carries no origin; only a dated tail does
      chain: { role: "head", origin: "2025-01-01" },
    };
    expect(bad).toBeDefined();
  });

  it("rejects a dated tail with no origin", () => {
    const bad: StmtResolution = {
      ...base,
      // @ts-expect-error — a `tail` must carry the chain's origin
      chain: { role: "tail" },
    };
    expect(bad).toBeDefined();
  });

  it("admits the three valid roles", () => {
    const head: StmtResolution = { ...base, chain: { role: "head" } };
    const tail: StmtResolution = {
      ...base,
      chain: { role: "tail", origin: "2025-01-01" },
    };
    const pending: StmtResolution = {
      ...base,
      chain: { role: "pending-tail" },
    };
    expect([head, tail, pending]).toHaveLength(3);
  });
});
