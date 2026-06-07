import {
  evaluateStatement,
  formatFinding,
  presentSchedule,
} from "@vestlang/evaluator";
import { evaluateProgramWithRecovery } from "@vestlang/recover";
import type { RecoveredTemplate } from "@vestlang/recover";
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
  };

  const ast = parse(input(parts, opts.stdin));
  const normalized = normalizeProgram(ast);

  // --program collapses every statement into ONE schedule and reports the
  // program-level verdict (`status`); the default classifies each statement on
  // its own. The collapsed path also runs template recovery: an events-only
  // program whose realized projection has a single-template form is rescued back
  // to a template (the same behavior as the MCP tool and library default).
  if (opts.program) {
    const outcome = evaluateProgramWithRecovery(normalized, ctx);
    printSchedule(outcome.schedule, true);
    if (outcome.rescued) printRecovered(outcome.recovered);
    return;
  }

  normalized
    .map((s) => evaluateStatement(s, ctx))
    .forEach((r) => printSchedule(r, false));
}

// When recovery fired, the schedule above prints as a plain `template`; this
// note says where it came from and shows the recovered DSL (which the engine
// can re-project, given the day-of-month convention — it isn't in the DSL text).
function printRecovered(recovered: RecoveredTemplate): void {
  console.log();
  console.log(`recovered: ${recovered.from} → template`);
  console.log(`  was: ${recovered.reason}`);
  console.log(`  dsl: ${recovered.dsl}`);
  console.log(
    `  vestingDayOfMonth: ${recovered.vestingDayOfMonth} (residual ${recovered.residualError})`,
  );
  console.log();
}

function printSchedule(r: EvaluatedSchedule, withStatus: boolean): void {
  // The consumer rule: "representable" is read from status, "pending" from
  // blockers (never from status === "unresolved"). A `template` carrying
  // blockers is representable-but-pending, not complete. "valid" is a separate
  // question — false when the schedule over-allocates the grant.
  const { representable, pending, valid } = presentSchedule(r);
  if (withStatus) {
    const reason = "reason" in r ? r.reason : undefined;
    const tags = [
      representable ? "representable" : null,
      pending ? "pending" : null,
      valid ? null : "invalid",
    ]
      .filter(Boolean)
      .join(", ");
    console.log();
    console.log(
      `status: ${r.status}${reason ? ` (${reason})` : ""}${tags ? ` — ${tags}` : ""}`,
    );
  }
  console.table(
    r.installments.map((item) => ({
      amount: item.amount,
      date: item.date ?? JSON.stringify(item.meta.symbolicDate),
      state: item.meta.state,
      unresolved: item.meta.unresolved,
    })),
  );
  // Show the projection above, then flag it — the schedule is printed but not
  // presented as valid. (Findings ride every schedule, so report them whether or
  // not the status line was printed.)
  r.findings.forEach((f) => console.log(`⚠ ${formatFinding(f)}`));
  if (r.blockers.length > 0) {
    console.log();
    console.log(
      pending ? "Blockers (pending — awaiting witnesses)" : "Blockers",
    );
    r.blockers.forEach((b) => console.log(JSON.stringify(b, null, 2)));
    console.log();
  }
}
