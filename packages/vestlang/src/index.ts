// Canonical interchange engine (shipped as a real external dependency)
export * as core from "@vestlang/core";

// Parser
export { parse } from "@vestlang/dsl";

// Normalizer
export { normalizeProgram } from "@vestlang/normalizer";

// Evaluator
export {
  evaluateStatement,
  evaluateProgram,
  evaluateStatementAsOf,
  presentSchedule,
} from "@vestlang/evaluator";
export type { VestedResult, SchedulePresentation } from "@vestlang/evaluator";

// Recover — the default program-eval surface: it runs the evaluator, then
// rescues an events-only verdict back to a template when the projection soundly
// has one. `evaluateProgram` above stays available for the recovery-free path.
export { evaluateProgramWithRecovery } from "@vestlang/recover";
export type { RecoveryOutcome, RecoveredTemplate } from "@vestlang/recover";

// Linter
export { lintProgram, lintText } from "@vestlang/linter";
export type { LintOptions, LintResult, Diagnostic } from "@vestlang/linter";

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
  Component,
  UniformComponent,
  SingleTrancheComponent,
  CliffUniformComponent,
} from "@vestlang/inferrer";

// Types (re-export commonly used types)
export type {
  Program,
  RawProgram,
  Statement,
  Schedule,
  EvaluationContextInput,
  EvaluatedSchedule,
  Installment,
  ResolvedInstallment,
  UnresolvedInstallment,
  ImpossibleInstallment,
  Blocker,
  OCTDate,
} from "@vestlang/types";
