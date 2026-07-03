// The reference compiler (shipped as a real external dependency)
export * as core from "@vestlang/core";

// The engine substrate core sits on — date math, the allocator, the grid kernel,
// the fold, the window analysis, the installment cap.
export * as primitives from "@vestlang/primitives";

// Parser
export { parse } from "@vestlang/dsl";

// Normalizer
export { normalizeProgram } from "@vestlang/normalizer";

// Evaluator (the spec-to-canonical compiler)
export type { VestedResult, StatementContribution } from "@vestlang/evaluator";

// Pipeline — the consumer front door; owns schedule presentation.
export { presentSchedule } from "@vestlang/pipeline";
export type { SchedulePresentation } from "@vestlang/pipeline";

// Recover — the public program-eval surface: it runs the evaluator, then rescues
// an events-only verdict back to a template when the projection soundly has one.
// (The recovery-free primitives — per-statement and per-program — stay in
// @vestlang/evaluator for internal callers like the inferrer; the public umbrella
// exposes only this one collapsed, program-scoped evaluate.)
export { evaluateProgramWithRecovery } from "@vestlang/recover";
export type { RecoveryOutcome, RecoveredTemplate } from "@vestlang/recover";

// Linter
export { lintProgram, lintText } from "@vestlang/linter";
export type { LintResult, Diagnostic } from "@vestlang/linter";

// Stringify
export {
  stringify,
  stringifyStatement,
  stringifyProgram,
} from "@vestlang/render";

// Inferrer (inverse of evaluate)
export { inferSchedule } from "@vestlang/inferrer";
export type {
  InferInput,
  InferResult,
  TrancheInput,
  DecompositionComponent,
  HypothesisFamily,
} from "@vestlang/inferrer";

// Types (re-export commonly used types)
export type {
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
} from "@vestlang/types";
