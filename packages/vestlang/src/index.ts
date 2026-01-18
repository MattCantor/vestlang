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

// Types (re-export commonly used types)
export type {
  Program,
  Statement,
  Schedule,
  EvaluationContextInput,
  EvaluatedSchedule,
  Installment,
  Blocker,
} from "@vestlang/types";
