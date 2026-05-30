import { evaluateStatement, evaluateProgram } from "@vestlang/evaluator";
import { getTodayISO, input, validateDate } from "./utils.js";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { EvaluationContext, EvaluatedSchedule } from "@vestlang/types";

export function evaluate(
  parts: string[],
  opts: {
    quantity: string;
    grantDate: string;
    event: Record<string, string>;
    stdin?: boolean;
    program?: boolean;
  },
): void {
  // quantity: must be a whole number
  const quantity = Number(opts.quantity);
  if (!Number.isInteger(quantity) || quantity < 0) {
    console.error("Quantity must be a non-negative whole number.");
    process.exit(1);
  }

  const ctx: EvaluationContext = {
    events: { ...opts.event, grantDate: validateDate(opts.grantDate) },
    grantQuantity: quantity,
    asOf: validateDate(getTodayISO()),
    vesting_day_of_month: "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH",
    allocation_type: "CUMULATIVE_ROUND_DOWN",
  };

  const ast = parse(input(parts, opts.stdin));
  const normalized = normalizeProgram(ast);

  // --program collapses every statement into ONE schedule and reports the
  // program-level interchange-fidelity verdict; the default classifies each
  // statement on its own.
  const results = opts.program
    ? evaluateProgram(normalized, ctx)
    : normalized.map((s) => evaluateStatement(s, ctx));

  results.forEach((r) => {
    printSchedule(r, opts.program === true);
  });
}

function printSchedule(r: EvaluatedSchedule, withFidelity: boolean): void {
  if (withFidelity) {
    console.log();
    console.log(`fidelity: ${r.fidelity}${r.reason ? ` (${r.reason})` : ""}`);
  }
  console.table(
    r.installments.map((item) => ({
      amount: item.amount,
      date: item.date ?? JSON.stringify(item.meta.symbolicDate),
      state: item.meta.state,
      unresolved: item.meta.unresolved,
    })),
  );
  if (r.blockers.length > 0) {
    console.log();
    console.log("Blockers");
    r.blockers.forEach((b) => console.log(JSON.stringify(b, null, 2)));
    console.log();
  }
}
