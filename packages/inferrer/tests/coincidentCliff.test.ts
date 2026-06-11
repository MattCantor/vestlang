import { describe, expect, it } from "vitest";
import { evaluateStatement } from "@vestlang/evaluator";
import type {
  EvaluationContextInput,
  VestingDayOfMonth,
} from "@vestlang/types";
import { buildStatement } from "../src/atoms.js";
import { splitCoincidentCliffs } from "../src/coincidentCliff.js";
import type {
  Component,
  SingleTrancheComponent,
  UniformComponent,
} from "../src/types.js";

// Unit tests for the coincident→offset normalization in isolation. The point of
// the pass is to let the existing cliff/pre-grant folds recognize the cliff shape
// decompose actually emits under CRD; these tests pin the boundary between "this
// is a coincident cliff, reshape it" and "leave it alone", and prove the reshape
// never changes the schedule it represents.

const DEFAULT_POLICY: VestingDayOfMonth =
  "VESTING_START_DAY_OR_LAST_DAY_OF_MONTH";

function uniform(
  startDate: string,
  perTrancheAmount: number,
  occurrences: number,
  cadence: UniformComponent["cadence"] = { unit: "MONTHS", length: 1 },
): UniformComponent {
  return {
    kind: "UNIFORM",
    startDate,
    cadence,
    occurrences,
    perTrancheAmount,
    total: perTrancheAmount * occurrences,
  };
}

function single(date: string, amount: number): SingleTrancheComponent {
  return { kind: "SINGLE_TRANCHE", date, amount };
}

/** The date→amount footprint a set of components actually vests to. Evaluated
 * against a far-past grant (so nothing lumps onto a grant cliff) and a far-future
 * as-of, so we see each component's natural installments. Two component sets with
 * the same footprint are interchangeable schedules — that's the safety property
 * the reshape must preserve. */
function footprint(
  components: Component[],
  policy: VestingDayOfMonth,
): Map<string, number> {
  const ctx: EvaluationContextInput = {
    grantDate: "1900-01-01",
    events: {},
    grantQuantity: 1_000_000,
    asOf: "2999-12-31",
    vesting_day_of_month: policy,
  };
  const out = new Map<string, number>();
  for (const c of components) {
    const res = evaluateStatement(buildStatement(c, policy), ctx);
    for (const inst of res.resolution.installments) {
      if (inst.state === "RESOLVED") {
        out.set(inst.date, (out.get(inst.date) ?? 0) + inst.amount);
      }
    }
  }
  return out;
}

describe("splitCoincidentCliffs — reshapes a genuine coincident cliff", () => {
  it("on-grid: lump on the train's first installment folds into an offset lump + shorter train", () => {
    // 100×4 from Feb, plus an extra 200 also on Feb → vests 300,100,100,100.
    const input: Component[] = [
      uniform("2024-02-01", 100, 4),
      single("2024-02-01", 200),
    ];

    const out = splitCoincidentCliffs(input, DEFAULT_POLICY);

    expect(out).toEqual([
      uniform("2024-03-01", 100, 3), // train shifted one period later, one shorter
      single("2024-02-01", 300), // lump absorbed the peeled first tranche
    ]);
    // The reshape is a pure re-representation: identical vested footprint.
    expect(footprint(out, DEFAULT_POLICY)).toEqual(
      footprint(input, DEFAULT_POLICY),
    );
  });

  it("only the coincident head folds; an unrelated tail train is left untouched", () => {
    const input: Component[] = [
      uniform("2024-02-01", 100, 4),
      uniform("2024-06-01", 50, 3), // separate tail, no lump on its start
      single("2024-02-01", 200),
    ];

    const out = splitCoincidentCliffs(input, DEFAULT_POLICY);

    expect(out).toEqual([
      uniform("2024-03-01", 100, 3),
      uniform("2024-06-01", 50, 3), // unchanged
      single("2024-02-01", 300),
    ]);
    expect(footprint(out, DEFAULT_POLICY)).toEqual(
      footprint(input, DEFAULT_POLICY),
    );
  });

  it("snapping policy: reshapes when the lump is on the train's ACTUAL first installment", () => {
    // Under the 29th-of-month convention this train's seed (Jan 1) is not where it
    // vests — its first installment is Jan 29. A lump on Jan 29 IS coincident.
    const policy: VestingDayOfMonth = "29_OR_LAST_DAY_OF_MONTH";
    const train = uniform("2024-01-01", 1000, 6);
    const input: Component[] = [train, single("2024-01-29", 2000)];

    // sanity: the train really does vest on the 29th, not on its Jan-1 seed.
    expect([...footprint([train], policy).keys()]).toContain("2024-01-29");
    expect([...footprint([train], policy).keys()]).not.toContain("2024-01-01");

    const out = splitCoincidentCliffs(input, policy);

    expect(out).toEqual([
      uniform("2024-02-29", 1000, 5), // starts at the train's SECOND installment
      single("2024-01-29", 3000),
    ]);
    expect(footprint(out, policy)).toEqual(footprint(input, policy));
  });
});

describe("splitCoincidentCliffs — leaves non-cliffs alone", () => {
  it("snapping policy: a lump on the train's SEED date (but not its real first installment) is not reshaped", () => {
    // The regression guard. Off-grid hire-date case: train seeded Jan 1 but
    // vesting on the 29th, with a lump on Jan 1 (the grant date). That lump is a
    // genuine pre-grant lump, NOT a coincident cliff — it must pass through so
    // foldPreGrant can handle it. (Comparing against the seed date instead of the
    // evaluated first installment would wrongly fold it.)
    const policy: VestingDayOfMonth = "29_OR_LAST_DAY_OF_MONTH";
    const input: Component[] = [
      uniform("2024-01-01", 1000, 6),
      single("2024-01-01", 3000),
    ];

    expect(splitCoincidentCliffs(input, policy)).toEqual(input);
  });

  it("jittery train (total ≠ perTranche × occurrences) is not reshaped", () => {
    const jittery: UniformComponent = {
      kind: "UNIFORM",
      startDate: "2024-02-01",
      cadence: { unit: "MONTHS", length: 1 },
      occurrences: 3,
      perTrancheAmount: 100,
      total: 301, // rounds to 100,100,101 — no clean first tranche to peel
    };
    const input: Component[] = [jittery, single("2024-02-01", 200)];

    expect(splitCoincidentCliffs(input, DEFAULT_POLICY)).toEqual(input);
  });

  it("a lump that is not a whole multiple of the per-tranche amount is not reshaped", () => {
    const input: Component[] = [
      uniform("2024-02-01", 100, 4),
      single("2024-02-01", 150), // 1.5 × per-tranche
    ];

    expect(splitCoincidentCliffs(input, DEFAULT_POLICY)).toEqual(input);
  });

  it("a two-occurrence train is not reshaped (shrinking it leaves no real train)", () => {
    const input: Component[] = [
      uniform("2024-02-01", 100, 2),
      single("2024-02-01", 100),
    ];

    expect(splitCoincidentCliffs(input, DEFAULT_POLICY)).toEqual(input);
  });

  it("a lump that does not sit on any train's first installment is not reshaped", () => {
    const input: Component[] = [
      uniform("2024-02-01", 100, 4),
      single("2025-06-15", 5000), // a one-off bonus elsewhere
    ];

    expect(splitCoincidentCliffs(input, DEFAULT_POLICY)).toEqual(input);
  });

  it("does not mutate the input array", () => {
    const input: Component[] = [
      uniform("2024-02-01", 100, 4),
      single("2024-02-01", 200),
    ];
    const snapshot = structuredClone(input);

    splitCoincidentCliffs(input, DEFAULT_POLICY);

    expect(input).toEqual(snapshot);
  });
});
