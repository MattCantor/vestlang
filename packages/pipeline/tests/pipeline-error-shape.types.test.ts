// AC#1 — the persistence/offset orchestrators are unified on the package's one
// `Result<T>` shape. Each result alias must be assignable to and from the bare
// `Result<…>` it stands for, so a refusal always carries a structured
// `PipelineError` (never a plain string). These assertions are type-level — they
// never execute — and are validated by `tsc` (which the root `typecheck` runs over
// `tests`). The runtime witness that no `error: string` arm survives lives in
// pipeline-error-shape.test.ts.

import { describe, it, expectTypeOf } from "vitest";
import type {
  Result,
  PersistResult,
  RehydrateResult,
  ResolveOffsetResult,
  RehydrateOutput,
} from "../src/index.js";
import type { PersistedArtifact } from "@vestlang/evaluator";
import type {
  AbsenceAssumption,
  Finding,
  OCTDate,
  UnresolvedBlocker,
  DeadBlocker,
} from "@vestlang/types";
import type { compileToInstallments } from "@vestlang/core";

type PersistOk = {
  artifact: PersistedArtifact;
  pending: UnresolvedBlocker[];
  dead: DeadBlocker[];
  warnings: Finding[];
};
// The offset success payload carries the resolved date and, only when a commit
// leaned on an unfired event, the message-enriched absence disclosure (#325). The
// field is optional — omitted on a plain resolve — so it sits as `?` here.
type OffsetOk = {
  date: OCTDate;
  absenceAssumptions?: (AbsenceAssumption & { message: string })[];
};

describe("the three orchestrator results are Result<T> (AC#1)", () => {
  it("PersistResult is exactly Result over its success payload", () => {
    expectTypeOf<PersistResult>().toEqualTypeOf<Result<PersistOk>>();
  });

  it("RehydrateResult is exactly Result over RehydrateOutput", () => {
    expectTypeOf<RehydrateResult>().toEqualTypeOf<Result<RehydrateOutput>>();
    // Sanity: RehydrateOutput is still its full success shape.
    expectTypeOf<RehydrateOutput["projection"]>().toEqualTypeOf<
      ReturnType<typeof compileToInstallments>
    >();
  });

  it("ResolveOffsetResult is exactly Result over { date }", () => {
    expectTypeOf<ResolveOffsetResult>().toEqualTypeOf<Result<OffsetOk>>();
  });

  it("every failure arm carries a structured PipelineError, not a string", () => {
    // Narrowing a refusal gives the structured error object; `.message` is a
    // string, `.error` itself is not.
    type PersistFail = Extract<PersistResult, { ok: false }>["error"];
    expectTypeOf<PersistFail>().not.toEqualTypeOf<string>();
    expectTypeOf<PersistFail["message"]>().toEqualTypeOf<string>();
  });
});
