import { evaluateStatement } from "@vestlang/evaluator";
import type {
  EvaluationContextInput,
  OCTDate,
  Statement,
} from "@vestlang/types";

/**
 * Evaluate a built statement and collapse its installments to a date→amount map.
 * Returns null if any installment is unresolved — i.e. the statement references
 * something the given context can't satisfy — so callers can reject it.
 *
 * One place owns "what dates and amounts does this statement actually vest to",
 * which both the pre-grant fold (matching a candidate train against the input)
 * and the coincident-cliff reshape (finding a train's real first installment)
 * need. The context decides whether pre-grant installments lump onto the grant
 * date: pass the real grant date to see the lump-up, or a far-past one to see a
 * train's natural installments.
 */
export function resolvedInstallmentMap(
  stmt: Statement,
  ctx: EvaluationContextInput,
): Map<OCTDate, number> | null {
  const { installments } = evaluateStatement(stmt, ctx);
  const map = new Map<OCTDate, number>();
  for (const inst of installments) {
    if (inst.meta.state !== "RESOLVED" || inst.date === undefined) return null;
    map.set(inst.date, (map.get(inst.date) ?? 0) + inst.amount);
  }
  return map;
}
