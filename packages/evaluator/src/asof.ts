import {
  AsOfContextInput,
  OCTDate,
  Program,
  Installment,
} from "@vestlang/types";
import { evaluateProgram } from "./evaluate/index.js";
import { assertProgramInstallmentCap } from "./resolve/index.js";
import { createEvaluationContext } from "./utils.js";
import { amountToFraction, claimAllocator } from "./claims.js";

export interface VestedResult {
  vested: Installment[];
  unvested: Installment[];
  impossible: Installment[];
  unresolved: number; // quantity not yet schedulable
  // The schedule's cliff date, carried alongside the partition so the summary
  // can read it without re-evaluating. A property of the schedule, not the as-of.
  cliffDate: OCTDate | null;
}

/**
 * Sort a schedule's tranches into vested / unvested / impossible as of `asOf`,
 * and tally the shares that aren't schedulable yet (unresolved). A schedule that
 * produced no tranches at all hasn't placed any of its shares, so the whole
 * allocation — `fallbackQuantity` — counts as unresolved.
 */
function partitionAsOf(
  installments: Installment[],
  asOf: OCTDate,
  fallbackQuantity: number,
): Omit<VestedResult, "cliffDate"> {
  const vested: Installment[] = [];
  const unvested: Installment[] = [];
  const impossible: Installment[] = [];
  let unresolved = 0;

  if (installments.length === 0) {
    return { vested, unvested, impossible, unresolved: fallbackQuantity };
  }

  for (const t of installments) {
    switch (t.state) {
      case "IMPOSSIBLE":
        impossible.push(t);
        unresolved += t.amount;
        break;
      case "UNRESOLVED":
        unresolved += t.amount;
        break;
      case "RESOLVED":
        (t.date <= asOf ? vested : unvested).push(t);
    }
  }

  return { vested, unvested, impossible, unresolved };
}

/**
 * As-of view of a whole program collapsed into ONE schedule. This is the answer
 * to "how much has vested?" for the grant — the program's statements merge into a
 * single tranche stream first, then we partition that. (Partitioning each
 * statement on its own and adding up the totals is both redundant and wrong for a
 * THEN chain, whose later segments can't be placed without the earlier ones.)
 */
export function evaluateProgramAsOf(
  program: Program,
  ctx_input: AsOfContextInput,
): VestedResult {
  assertProgramInstallmentCap(program);
  const ctx = createEvaluationContext(ctx_input);
  const schedule = evaluateProgram(program, ctx_input);
  // If nothing got scheduled, every share the program allocates is still
  // unresolved. One cursor across the whole program — the same telescoping the
  // symbolic lumps use — so this is min(floor(grant × Σ fractions), grant),
  // never a sum of independent per-statement floors.
  const draw = claimAllocator(ctx.grantQuantity);
  const programQuantity = program.reduce(
    (n, s) => n + draw(amountToFraction(s.amount, ctx.grantQuantity)),
    0,
  );
  return {
    ...partitionAsOf(
      schedule.resolution.installments,
      ctx.asOf,
      programQuantity,
    ),
    cliffDate: schedule.cliffDate,
  };
}
