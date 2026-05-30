import {
  EvaluationContextInput,
  Program,
  Statement,
  EvaluatedSchedule,
} from "@vestlang/types";
import { resolveToCore } from "../resolve/index.js";
import { assemble } from "../resolve/assemble.js";

/**
 * Evaluate one normalized Statement: resolve the one-statement program against
 * runtime, classify its interchange fidelity, and assemble the tagged
 * EvaluatedSchedule. (The legacy in-evaluator engine was removed in Phase 5b.)
 */
export function evaluateStatement(
  stmt: Statement,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule {
  return assemble(resolveToCore([stmt], ctx_input));
}

/**
 * Evaluate a whole program. The program collapses to ONE canonical schedule
 * (single cumulative round-down across the ordered template), returned as a
 * one-element array.
 */
export function evaluateProgram(
  stmts: Program,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule[] {
  return [assemble(resolveToCore(stmts, ctx_input))];
}
