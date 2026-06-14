import {
  parseQuantity,
  validateDate,
  runEvaluate,
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

  // The whole program collapses into ONE schedule, reported with its grant-level
  // verdict. This runs template recovery: an events-only program whose realized
  // projection has a single-template form is rescued back to a template (the same
  // behavior as the MCP tool and the library default). The MCP tool also returns a
  // per-clause breakdown; the CLI drops it — it's a minimal dev tool.
  const result = runEvaluate(dsl, grant);
  if (!result.ok) fail(result.error);
  printSchedule(result.view);
  if (result.recovered) printRecovered(result.recovered);
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

function printSchedule(view: ScheduleView): void {
  // Two verdicts, printed side by side: what the record keeper could store
  // ("storable", the firing-invariant verdict), and what the schedule resolves to
  // given the events we know ("resolves to"). The read-flags hang off them:
  // "representable" tracks the storable verdict, "pending" comes from the pending
  // blockers (not from a "resolves to: unresolved"), "dead" flags anything
  // contradicted by the firings, and "valid" is its own question — false when the
  // schedule over-allocates the grant.
  const tags = [
    view.representable ? "representable" : null,
    view.pending ? "pending" : null,
    view.dead ? "dead" : null,
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
  console.table(
    view.installments.map((item) => ({
      amount: item.amount,
      date:
        item.state === "RESOLVED"
          ? item.date
          : item.state === "UNRESOLVED"
            ? JSON.stringify(item.symbolicDate)
            : undefined,
      state: item.state,
      unresolved: item.state === "RESOLVED" ? undefined : item.unresolved,
    })),
  );
  // Show the projection above, then flag it — the schedule is printed but not
  // presented as valid. Findings ride the schedule with their message already
  // rendered (e.g. over-allocation), so just echo them.
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
  // Two blocker lists, labeled by reading. Pending ones are still awaiting their
  // witnesses; dead ones can never resolve given the firings, so an operator should
  // stop waiting on them.
  if (view.pendingBlockers.length > 0) {
    console.log();
    console.log("Blockers (pending — awaiting witnesses)");
    view.pendingBlockers.forEach((b) =>
      console.log(JSON.stringify(b, null, 2)),
    );
    console.log();
  }
  if (view.deadBlockers.length > 0) {
    console.log();
    console.log("Blockers (dead — can never resolve given the firings)");
    view.deadBlockers.forEach((b) => console.log(JSON.stringify(b, null, 2)));
    console.log();
  }
}
