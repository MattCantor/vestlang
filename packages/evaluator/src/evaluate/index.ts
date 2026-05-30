import {
  EvaluationContextInput,
  Program,
  Statement,
  EvaluatedSchedule,
} from "@vestlang/types";
import { evaluateStatement as legacyEvaluateStatement } from "./build.js";
import { resolveToCore } from "../resolve/index.js";
import { assemble } from "../resolve/assemble.js";

// Phase 5a cutover: the public evaluate path runs through resolve → classify →
// assemble → core. The legacy in-evaluator engine stays reachable behind this
// internal flag for revert safety during cutover (Phase 5b deletes both). It is
// NOT re-exported from the `vestlang` umbrella, so the public surface is unchanged.
let legacyEngine = false;

/** Toggle the legacy in-evaluator engine (revert safety; internal — not public surface). */
export function __useLegacyEngine(on: boolean): void {
  legacyEngine = on;
}

/**
 * Evaluate one normalized Statement. New path: resolve the one-statement program
 * against runtime, classify its interchange fidelity, and assemble the tagged
 * EvaluatedSchedule. Per-statement contract preserved for all consumers.
 */
export function evaluateStatement(
  stmt: Statement,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule {
  if (legacyEngine) return legacyEvaluateStatement(stmt, ctx_input);
  return assemble(resolveToCore([stmt], ctx_input));
}

/**
 * Evaluate a whole program. New path: the program collapses to ONE canonical
 * schedule (single cumulative round-down across the ordered template), returned
 * as a one-element array. Legacy path keeps the per-statement mapping.
 */
export function evaluateProgram(
  stmts: Program,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule[] {
  if (legacyEngine) {
    return stmts.map((stmt) => legacyEvaluateStatement(stmt, ctx_input));
  }
  return [assemble(resolveToCore(stmts, ctx_input))];
}
