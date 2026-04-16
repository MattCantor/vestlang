// Parser
export { parse } from "@vestlang/dsl";

// Normalizer
export { normalizeProgram } from "@vestlang/normalizer";

// Evaluator
export { evaluateStatement, evaluateProgram, evaluateStatementAsOf } from "@vestlang/evaluator";
export type { VestedResult } from "@vestlang/evaluator";

// Linter
export { lintProgram, lintText } from "@vestlang/linter";
export type { LintOptions, LintResult, Diagnostic } from "@vestlang/linter";

// Stringify
export { stringify, stringifyStatement, stringifyProgram } from "@vestlang/stringify";

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
