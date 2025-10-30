import { EvaluationContextInput, Program, Tranche } from "@vestlang/types";
import { buildSchedule } from "./build.js";

export function buildProgram(stmts: Program, ctx_input: EvaluationContextInput): Tranche[][] {
  return stmts.map(stmt => buildSchedule(stmt, ctx_input))
}

export { buildSchedule } from "./build.js"
