import {
  buildScheduleWithBlockers,
  EvaluationContext,
} from "@vestlang/evaluator";
import { getTodayISO, input, validateDate } from "./utils.js";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";

export function build(
  parts: string[],
  opts: {
    quantity: string;
    grantDate: string;
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
    asOf: validateDate(getTodayISO()),
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    allocation_type: "CUMULATIVE_ROUND_DOWN",
  };

  const ast = parse(input(parts, opts.stdin));
  const normalized = normalizeProgram(ast);
  const results = normalized.map((s) => buildScheduleWithBlockers(s, ctx));
  results.forEach((r) => {
    console.table(
      r.map((item) => ({
        ...item,
        status: JSON.stringify(item.status),
        symbolicDate: JSON.stringify(item.symbolicDate),
        blockers: item.blockers.map((b) => JSON.stringify(b)),
      })),
    );
  });
}
