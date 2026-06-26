// Issue #441 — `scheduled` is breakdown-only: it must NOT widen the shared
// `ResolvedInstallment`, the wire `Installment` union, or the stored
// `PersistedArtifact`. These are compile-time assertions in the `@ts-expect-error`
// style of `packages/evaluator/tests/issue-320.types.test.ts`, checked by the root
// `typecheck` (tsconfig.lint.json pulls in test files). The bodies never run; if a
// guarantee regresses the directive goes unused and the build fails.
//
// Only the absent-member (negative) side lives here. The positive side —
// `BreakdownResolvedInstallment` DOES carry `scheduled` — is covered by the runtime
// ACs (AC1/AC4); importing the module-local resolved arm here is deliberately
// avoided so knip stays green.

import { describe, it, expect } from "vitest";
import type { ResolvedInstallment, Installment } from "@vestlang/types";
import type { PersistedArtifact } from "@vestlang/evaluator";

describe("#441 — scheduled never leaks onto the shared / wire / stored shapes", () => {
  it("the shared ResolvedInstallment has no scheduled member", () => {
    const inst: ResolvedInstallment = {
      state: "RESOLVED",
      amount: 1,
      date: "2025-01-01",
    };
    // @ts-expect-error — ResolvedInstallment is { state, amount, date }, no `scheduled` (TS2339)
    const leaked = inst.scheduled;
    expect([inst, leaked]).toHaveLength(2);
  });

  it("a RESOLVED-narrowed wire Installment gained no scheduled member", () => {
    const wire = {
      state: "RESOLVED",
      amount: 1,
      date: "2025-01-01",
    } as Installment;
    if (wire.state === "RESOLVED") {
      // @ts-expect-error — the wire Installment union gained no `scheduled` member (TS2339)
      const leaked = wire.scheduled;
      expect([wire, leaked]).toHaveLength(2);
    }
  });

  it("a PersistedArtifact has no projection installments at all", () => {
    const artifact = {} as PersistedArtifact;
    // @ts-expect-error — PersistedArtifact keys are exactly { template, runtime, sidecar } (TS2339)
    const projection = artifact.installments;
    expect([artifact, projection]).toHaveLength(2);
  });
});
