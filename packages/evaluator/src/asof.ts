import {
  EvaluationContextInput,
  Statement as NormalizedStatement,
  Tranche,
} from "@vestlang/types";
import { evaluateStatement } from "./evaluate/index.js";
import { prepare } from "./utils.js";

export interface VestedResult {
  vested: Tranche[];
  unvested: Tranche[];
  impossible: Tranche[];
  unresolved: number; // quantity not yet schedulable
}

/**
 * Evaluate a normallized Statement as of a given date.
 * Expands the schedule, converts amount -> quantity, and splits tranches
 */
export function evaluateStatementAsOf(
  stmt: NormalizedStatement,
  ctx_input: EvaluationContextInput,
): VestedResult {
  const { ctx, statementQuantity } = prepare(stmt, ctx_input);

  const tranches = evaluateStatement(stmt, ctx_input);

  const vested: Tranche[] = [];
  const unvested: Tranche[] = [];
  const impossible: Tranche[] = [];
  let unresolved = 0;

  if (tranches.length === 0) {
    return {
      vested,
      unvested,
      impossible,
      unresolved: statementQuantity,
    };
  }

  for (const t of tranches) {
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
