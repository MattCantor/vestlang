import {
  EvaluationContextInput,
  Program,
  EvaluatedSchedule,
} from "@vestlang/types";
import { evaluateStatement } from "./build.js";

export function evaluateProgram(
  stmts: Program,
  ctx_input: EvaluationContextInput,
): EvaluatedSchedule[] {
  return stmts.map((stmt) => evaluateStatement(stmt, ctx_input));
}

export { evaluateStatement } from "./build.js";
