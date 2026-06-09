import {
  parseQuantity,
  validateDate,
  runEvaluate,
  runEvaluateProgram,
  type ScheduleView,
  type RecoveredView,
} from "@vestlang/pipeline";
import { input, fail } from "./utils.js";

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
  const quantity = parseQuantity(opts.quantity);
  if (!quantity.ok) fail(quantity.error);
  const grantDate = validateDate(opts.grantDate);
  if (!grantDate.ok) fail(grantDate.error);

  const grant = {
    grant_date: grantDate.date,
    grant_quantity: quantity.quantity,
    events: opts.event,
  };
  const dsl = input(parts, opts.stdin);

  // --program collapses every statement into ONE schedule and reports the
  // program-level verdict (`status`); the default classifies each statement on
  // its own. The collapsed path also runs template recovery: an events-only
  // program whose realized projection has a single-template form is rescued back
  // to a template (the same behavior as the MCP tool and library default).
  if (opts.program) {
    const result = runEvaluateProgram(dsl, grant);
    if (!result.ok) fail(result.error);
    printSchedule(result.view, true);
    if (result.recovered) printRecovered(result.recovered);
    return;
  }

  const result = runEvaluate(dsl, grant);
  if (!result.ok) fail(result.error);
  result.views.forEach((view) => printSchedule(view, false));
}

// When recovery fired, the schedule above prints as a plain `template`; this
// note says where it came from and shows the recovered DSL (which the engine
// can re-project, given the day-of-month convention — it isn't in the DSL text).
function printRecovered(recovered: RecoveredView): void {
  console.log();
  console.log(`recovered: ${recovered.from} → template`);
  console.log(`  was: ${recovered.reason}`);
  console.log(`  dsl: ${recovered.dsl}`);
  console.log(
    `  vestingDayOfMonth: ${recovered.vestingDayOfMonth} (residual ${recovered.residualError})`,
  );
  console.log();
}

function printSchedule(view: ScheduleView, withStatus: boolean): void {
  // Two verdicts, printed side by side: what the record keeper could store
  // ("storable", the firing-invariant verdict), and what the schedule resolves to
  // given the events we know ("resolves to"). The read-flags hang off them:
  // "representable" tracks the storable verdict, "pending" comes from the blockers
  // (not from a "resolves to: unresolved"), and "valid" is its own question —
  // false when the schedule over-allocates the grant.
  if (withStatus) {
    const tags = [
      view.representable ? "representable" : null,
      view.pending ? "pending" : null,
      view.valid ? null : "invalid",
    ]
      .filter(Boolean)
      .join(", ");
    const storableReason =
      "reason" in view.interchange ? ` (${view.interchange.reason})` : "";
    const resolvesReason =
      "reason" in view.resolution ? ` (${view.resolution.reason})` : "";
    console.log();
    console.log(`storable: ${view.interchange.status}${storableReason}`);
    console.log(
      `resolves to: ${view.resolution.status}${resolvesReason}${tags ? ` — ${tags}` : ""}`,
    );
  }
  console.table(
    view.installments.map((item) => ({
      amount: item.amount,
      date: item.date ?? JSON.stringify(item.meta.symbolicDate),
      state: item.meta.state,
      unresolved: item.meta.unresolved,
    })),
  );
  // Show the projection above, then flag it — the schedule is printed but not
  // presented as valid. (Findings ride every schedule, with their message
  // already rendered, so report them whether or not a status line was printed.)
  view.findings.forEach((f) => console.log(`⚠ ${f.message}`));
  // What the "resolves to" reading is quietly taking for granted: events we're
  // assuming haven't happened yet (and by when). If one of them later turns out to
  // have occurred, the projection above can change.
  if (view.absenceAssumptions.length > 0) {
    console.log();
    console.log("Assumes these events have not yet occurred:");
    view.absenceAssumptions.forEach((a) => console.log(`  ${a.message}`));
    console.log();
  }
  if (view.blockers.length > 0) {
    console.log();
    console.log(
      view.pending ? "Blockers (pending — awaiting witnesses)" : "Blockers",
    );
    view.blockers.forEach((b) => console.log(JSON.stringify(b, null, 2)));
    console.log();
  }
}
