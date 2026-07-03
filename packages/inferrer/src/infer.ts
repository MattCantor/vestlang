import { MAX_INSTALLMENTS } from "@vestlang/primitives";
import { stringify } from "@vestlang/render";
import type { Program } from "@vestlang/types";
import { DEFAULT_VESTING_DAY_OF_MONTH } from "@vestlang/types";
import { analyze } from "./analytic/index.js";
import { bareLumpStmt } from "./analytic/emit.js";
import { InferInputError } from "./errors.js";
import type { InferInput, InferResult } from "./types.js";

/**
 * Reconstruct a vestlang program from an observed `{ date, amount }` tranche
 * stream. The heavy lifting is the analytic hypothesize-and-verify core
 * (`./analytic/`): candidate templates are derived in closed form from the
 * stream's date lattice and cumulative sums, each is verified by one real
 * evaluation, and the first verifying candidate in a fixed preference order wins;
 * anything unrecognized degrades to a projection-lossless literal per-date list.
 *
 * `inferSchedule` owns the surface contract around that core: the input guard, the
 * all-zero short-circuit, grant-date defaulting, and shaping the tagged
 * decomposition and diagnostics.
 */
export function inferSchedule(input: InferInput): InferResult {
  if (input.tranches.length === 0) {
    throw new InferInputError("tranches must not be empty");
  }
  // Bound the inference work downstream of parsing, which scales with the number
  // of rows. The cap reuses the evaluator's installment ceiling: the engine never
  // expands more than MAX_INSTALLMENTS installments, and a real schedule tops out
  // near 500 tranches (a 40-year monthly grant), so this is generous headroom, not
  // a new magic number. Strict `>` matches the evaluator's own total-vs-cap
  // convention, so a length exactly at the cap is accepted.
  if (input.tranches.length > MAX_INSTALLMENTS) {
    throw new InferInputError(
      `tranches has ${input.tranches.length} entries, exceeds the limit of ${MAX_INSTALLMENTS}`,
    );
  }
  input.tranches.forEach((t, i) => {
    if (!Number.isInteger(t.amount) || t.amount < 0) {
      throw new InferInputError(
        `tranche amounts must be non-negative integers (got ${t.amount} at index ${i})`,
      );
    }
  });

  const totalQuantity = input.tranches.reduce((a, t) => a + t.amount, 0);
  const firstDate = input.tranches.reduce(
    (min, t) => (t.date < min ? t.date : min),
    input.tranches[0].date,
  );
  const grantDate = input.grantDate ?? firstDate;

  // Every surviving tranche is zero: the analytic core would decompose an empty
  // date set, so short-circuit to a single `0 VEST FROM DATE <earliest>` — a valid
  // one-statement template that evaluates to an empty installment stream. Exact by
  // construction (total 0 → nothing to place), so residual is 0 directly.
  if (totalQuantity === 0) {
    const dom = input.policy ?? DEFAULT_VESTING_DAY_OF_MONTH;
    const program: Program = [bareLumpStmt(0, firstDate)];
    const notes = [
      "all tranches were zero; emitted a single zero-quantity statement",
    ];
    if (input.grantDate === undefined) {
      notes.push(`grantDate defaulted to first tranche date (${firstDate})`);
    }
    return {
      dsl: stringify(program),
      program,
      decomposition: [
        {
          tag: "literal",
          start: firstDate,
          occurrences: 1,
          period: { unit: "DAYS", length: 0 },
          total: 0,
        },
      ],
      diagnostics: {
        residualError: 0,
        totalQuantity: 0,
        vestingDayOfMonth: dom,
        fallback: false,
        notes,
      },
    };
  }

  const result = analyze(input.tranches, grantDate, input.policy);

  const notes: string[] = [];
  if (input.grantDate === undefined) {
    notes.push(`grantDate defaulted to first tranche date (${firstDate})`);
  }
  // A pre-grant fold recovers a vesting start earlier than the grant date; surface
  // it, since the emitted DSL reads as a plain back-dated train.
  for (const c of result.components) {
    if (c.tag === "fold" && c.start !== null && c.start < grantDate) {
      notes.push(
        `lump on grant date ${grantDate} reinterpreted as vesting start ${c.start} (pre-grant accrual)`,
      );
    }
  }
  if (result.fallback) {
    notes.push(
      "no template shape verified; emitted the literal per-date fallback",
    );
  }

  return {
    dsl: result.dsl,
    program: result.program,
    decomposition: result.components,
    diagnostics: {
      // Verification is exact projection equality and the fallback is
      // projection-lossless, so the emitted program always reproduces the input.
      residualError: 0,
      totalQuantity,
      vestingDayOfMonth: result.dom,
      fallback: result.fallback,
      notes,
    },
  };
}
