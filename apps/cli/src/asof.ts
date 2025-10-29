import { evaluateStatementAsOf } from "@vestlang/evaluator";
import { getTodayISO, input, validateDate } from "./utils.js";
import { normalizeProgram } from "@vestlang/normalizer";
import { parse } from "@vestlang/dsl";
import { EvaluationContext } from "@vestlang/types";

export function asof(
  parts: string[],
  opts: {
    quantity: string;
    grantDate: string;
    date?: string;
    stdin?: boolean;
  },
): void {
  // quantity: must be a whole number
  const quantity = Number(opts.quantity);
  if (!Number.isInteger(quantity) || quantity < 0) {
    console.error("Quantity must be a non-negative whole number.");
    process.exit(1);
  }

  const ctx: EvaluationContext = {
    events: { grantDate: validateDate(opts.grantDate) },
    grantQuantity: quantity,
    asOf: validateDate(opts.date ?? getTodayISO()),
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    allocation_type: "CUMULATIVE_ROUND_DOWN",
  };

  const ast = parse(input(parts, opts.stdin));
  const normalized = normalizeProgram(ast);
  const results = normalized.map((s) => evaluateStatementAsOf(s, ctx));
  results.forEach((r) => {
    console.log("VESTED");
    console.table(r.vested);
    console.log("UNVESTED");
    console.table(r.unvested);
    console.log("UNRESOLVED");
    console.log(r.unresolved);
  });
}
