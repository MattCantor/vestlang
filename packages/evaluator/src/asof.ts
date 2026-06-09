import {
  EvaluationContextInput,
  Program,
  Statement,
  Installment,
} from "@vestlang/types";
import { evaluateStatement } from "./evaluate/index.js";
import { assertProgramInstallmentCap } from "./resolve/index.js";
import { prepare } from "./utils.js";

export interface VestedResult {
  vested: Installment[];
  unvested: Installment[];
  impossible: Installment[];
  unresolved: number; // quantity not yet schedulable
}

/**
 * Evaluate a normallized Statement as of a given date.
 * Expands the schedule, converts amount -> quantity, and splits tranches
 */
export function evaluateStatementAsOf(
  stmt: Statement,
  ctx_input: EvaluationContextInput,
): VestedResult {
  const { ctx, statementQuantity } = prepare(stmt, ctx_input);

  const installments = evaluateStatement(stmt, ctx_input).resolution
    .installments;

  const vested: Installment[] = [];
  const unvested: Installment[] = [];
  const impossible: Installment[] = [];
  let unresolved = 0;

  if (installments.length === 0) {
    return {
      vested,
      unvested,
      impossible,
      unresolved: statementQuantity,
    };
  }

  for (const t of installments) {
    switch (t.meta.state) {
      case "IMPOSSIBLE":
        impossible.push(t);
        unresolved += t.amount;
        break;
      case "UNRESOLVED":
        unresolved += t.amount;
        break;
      case "RESOLVED":
        (t.date! <= ctx.asOf ? vested : unvested).push(t);
    }
  }

  return { vested, unvested, impossible, unresolved };
}

/**
 * As-of sibling of `evaluateStatements`: evaluate each statement of a program as
 * of `ctx.asOf`. The per-statement as-of consumers use this rather than a
 * hand-rolled map, so the whole-program installment cap is enforced once.
 */
export function evaluateStatementsAsOf(
  program: Program,
  ctx_input: EvaluationContextInput,
): VestedResult[] {
  assertProgramInstallmentCap(program);
  return program.map((stmt) => evaluateStatementAsOf(stmt, ctx_input));
}
