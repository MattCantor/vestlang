// Locks the umbrella's re-exported type surface. The imports are type-only, so
// `pnpm test` runs this green regardless; `pnpm typecheck` is what enforces it —
// a removed or renamed re-export fails to resolve, and each name must resolve to
// a concrete type rather than silently collapse to `any`.
import { it, expectTypeOf } from "vitest";
import type {
  VestedResult,
  StatementContribution,
  SchedulePresentation,
  VerifyInput,
  VerifyResult,
  VerificationResult,
  VerificationRow,
  BalanceRow,
  TrancheRow,
  FigureCheck,
  NearestInstallment,
  Observation,
  VerifyTolerance,
  RecoveryOutcome,
  RecoveredTemplate,
  LintResult,
  Diagnostic,
  InferInput,
  InferResult,
  TrancheInput,
  DecompositionComponent,
  HypothesisFamily,
  RecoveryMode,
  Program,
  RawProgram,
  Statement,
  Schedule,
  ResolutionContextInput,
  AsOfContextInput,
  EvaluatedSchedule,
  Installment,
  ResolvedInstallment,
  UnresolvedInstallment,
  ImpossibleInstallment,
  Blocker,
  OCTDate,
} from "@vestlang/vestlang";

it("re-exports every type in the umbrella's curated surface", () => {
  expectTypeOf<VestedResult>().not.toBeAny();
  expectTypeOf<StatementContribution>().not.toBeAny();
  expectTypeOf<SchedulePresentation>().not.toBeAny();
  expectTypeOf<VerifyInput>().not.toBeAny();
  expectTypeOf<VerifyResult>().not.toBeAny();
  expectTypeOf<VerificationResult>().not.toBeAny();
  expectTypeOf<VerificationRow>().not.toBeAny();
  expectTypeOf<BalanceRow>().not.toBeAny();
  expectTypeOf<TrancheRow>().not.toBeAny();
  expectTypeOf<FigureCheck>().not.toBeAny();
  expectTypeOf<NearestInstallment>().not.toBeAny();
  expectTypeOf<Observation>().not.toBeAny();
  expectTypeOf<VerifyTolerance>().not.toBeAny();
  // The verification output reports facts, never a composite confidence score.
  expectTypeOf<VerificationResult>().not.toHaveProperty("score");
  expectTypeOf<RecoveryOutcome>().not.toBeAny();
  expectTypeOf<RecoveredTemplate>().not.toBeAny();
  expectTypeOf<LintResult>().not.toBeAny();
  expectTypeOf<Diagnostic>().not.toBeAny();
  expectTypeOf<InferInput>().not.toBeAny();
  expectTypeOf<InferResult>().not.toBeAny();
  expectTypeOf<TrancheInput>().not.toBeAny();
  expectTypeOf<DecompositionComponent>().not.toBeAny();
  expectTypeOf<HypothesisFamily>().not.toBeAny();
  expectTypeOf<RecoveryMode>().not.toBeAny();
  expectTypeOf<Program>().not.toBeAny();
  expectTypeOf<RawProgram>().not.toBeAny();
  expectTypeOf<Statement>().not.toBeAny();
  expectTypeOf<Schedule>().not.toBeAny();
  expectTypeOf<ResolutionContextInput>().not.toBeAny();
  expectTypeOf<AsOfContextInput>().not.toBeAny();
  expectTypeOf<EvaluatedSchedule>().not.toBeAny();
  expectTypeOf<Installment>().not.toBeAny();
  expectTypeOf<ResolvedInstallment>().not.toBeAny();
  expectTypeOf<UnresolvedInstallment>().not.toBeAny();
  expectTypeOf<ImpossibleInstallment>().not.toBeAny();
  expectTypeOf<Blocker>().not.toBeAny();
  expectTypeOf<OCTDate>().not.toBeAny();
});
