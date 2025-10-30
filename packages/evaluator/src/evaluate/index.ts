import { EvaluationContextInput, Program, Tranche } from "@vestlang/types";
import { evaluateStatement } from "./build.js";

export function evaluateProgram(stmts: Program, ctx_input: EvaluationContextInput): Tranche[][] {
  return stmts.map(stmt => evaluateStatement(stmt, ctx_input))
}

export { evaluateStatement } from "./build.js"
