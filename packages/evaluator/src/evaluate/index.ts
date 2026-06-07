import {
  EvaluationContextInput,
  Program,
  Statement,
  EvaluatedSchedule,
} from "@vestlang/types";
import {
  resolveToCore,
  assertProgramInstallmentCap,
} from "../resolve/index.js";
import { assemble } from "../resolve/assemble.js";

/**
 * Evaluate one normalized Statement: resolve the one-statement program against
 * runtime, classify its verdict (`status`), and assemble the tagged
 * EvaluatedSchedule.
 */
export function evaluateStatement(
  stmt: Statement,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule {
  return assemble(resolveToCore([stmt], ctx_input));
}

/**
 * Evaluate each statement of a program on its own (the per-statement view: one
 * EvaluatedSchedule per statement, classified independently). This is the entry
 * per-statement consumers use — NOT a hand-rolled `program.map(evaluateStatement)`
 * — because the installment cap spans the whole program: mapping `evaluateStatement`
 * bounds each statement to the limit but not their sum.
 */
export function evaluateStatements(
  program: Program,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule[] {
  assertProgramInstallmentCap(program);
  return program.map((stmt) => evaluateStatement(stmt, ctx_input));
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
