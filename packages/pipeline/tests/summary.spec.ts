import { describe, it, expect } from "vitest";
import { parse } from "@vestlang/dsl";
import { normalizeProgram } from "@vestlang/normalizer";
import { evaluateProgramAsOf } from "@vestlang/evaluator";
import type { AsOfContextInput } from "@vestlang/types";
import { computeSummary, filterByWindow } from "../src/summary";
import { runAsOf, runEvaluate } from "../src/run";

// computeSummary / filterByWindow run over a real as-of evaluation, so these
// drive a DSL string through the engine and check the roll-up the consumers
// print.

const ctx = (overrides: Partial<AsOfContextInput> = {}): AsOfContextInput => ({
  grantDate: "2025-01-01",
  events: {},
  grantQuantity: 100000,
  asOf: "2026-04-16",
  ...overrides,
});

const run = (dsl: string, context = ctx()) =>
  evaluateProgramAsOf(normalizeProgram(parse(dsl)), context);

describe("computeSummary", () => {
  it("sums vested and reports percent for mid-schedule as_of", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const s = computeSummary(result, 100000);

    // Cliff (25000) + 3 monthly tranches of ~2083 each = 31250
    expect(s.total_vested).toBe(31250);
    expect(s.total_unvested).toBe(68750);
    expect(s.total_impossible).toBe(0);
    expect(s.percent_vested).toBe(0.3125);
    expect(s.cliff_date).toBe("2026-01-01");
    expect(s.next_vest_date).toBe("2026-05-01");
    expect(s.fully_vested_date).toBe("2029-01-01");
  });

  it("fully_vested_date is null when schedule has unresolved installments", () => {
    const result = run(
      "VEST FROM EVENT ipo OVER 2 years EVERY 1 month",
      ctx({ grantDate: "2025-01-01", events: {} }),
    );
    const s = computeSummary(result, 100000);
    expect(s.fully_vested_date).toBeNull();
    expect(s.total_vested).toBe(0);
  });

  it("cliff_date reports the schedule cliff before anything has vested", () => {
    // cliff_date is a property of the schedule, so it's known before the cliff
    // passes — not derived from what has already vested.
    const result = run(
      "VEST OVER 4 years EVERY 1 month CLIFF 1 year",
      ctx({ asOf: "2025-06-01" }),
    );
    const s = computeSummary(result, 100000);
    expect(s.cliff_date).toBe("2026-01-01");
    expect(s.total_vested).toBe(0);
    expect(s.next_vest_date).toBe("2026-01-01");
    expect(s.next_vest_amount).toBe(25000);
  });

  // Issue #140 repro: the cliff date must be the same date no matter when we ask
  // — before the grant, before the cliff, or on it.
  it("cliff_date is the schedule cliff regardless of as_of (issue #140)", () => {
    const dsl = "VEST OVER 48 months EVERY 1 month CLIFF 12 months";
    for (const asOf of [
      "2024-06-01", // before the grant
      "2025-12-01", // before the cliff
      "2025-12-31", // day before the cliff
      "2026-01-01", // on the cliff
    ]) {
      const result = run(
        dsl,
        ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf }),
      );
      const s = computeSummary(result, 4800);
      expect(s.cliff_date).toBe("2026-01-01");
    }
  });

  it("cliff_date is null when the schedule has no cliff", () => {
    // A no-cliff schedule used to report its first monthly tranche as a phantom
    // cliff (e.g. 2025-02-01); now it reports none.
    const result = run(
      "VEST OVER 48 months EVERY 1 month",
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2025-06-15" }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBeNull();
  });

  it("cliff_date is null while an event-anchored start is unfired", () => {
    // The cliff is a fixed duration after the start, but the start event hasn't
    // fired, so the cliff has no placeable date yet.
    const result = run(
      "VEST FROM EVENT ipo OVER 48 months EVERY 1 month CLIFF 12 months",
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, events: {} }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBeNull();
  });

  it("cliff_date is computed from the firing once the start event fires", () => {
    const result = run(
      "VEST FROM EVENT ipo OVER 48 months EVERY 1 month CLIFF 12 months",
      ctx({
        grantDate: "2025-01-01",
        grantQuantity: 4800,
        events: { ipo: "2025-06-10" },
        asOf: "2025-12-01",
      }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBe("2026-06-10"); // firing + 12 months
  });

  it("an unfired event cliff has no cliff_date", () => {
    const result = run(
      "VEST OVER 48 months EVERY 1 month CLIFF EVENT fda",
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, events: {} }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBeNull();
  });

  it("a fired event cliff reports its effective date regardless of as_of", () => {
    const dsl = "VEST OVER 48 months EVERY 1 month CLIFF EVENT fda";
    for (const asOf of ["2025-06-01", "2027-01-01"]) {
      const result = run(
        dsl,
        ctx({
          grantDate: "2025-01-01",
          grantQuantity: 4800,
          events: { fda: "2026-03-15" },
          asOf,
        }),
      );
      const s = computeSummary(result, 4800);
      expect(s.cliff_date).toBe("2026-03-15"); // the firing itself
    }
  });

  it("a PLUS program reports the earliest placeable cliff", () => {
    const result = run(
      "1/2 VEST OVER 24 months EVERY 1 month CLIFF 6 months PLUS " +
        "1/2 VEST FROM DATE 2026-01-01 OVER 24 months EVERY 1 month CLIFF 12 months",
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2025-03-01" }),
    );
    const s = computeSummary(result, 4800);
    // First grid's cliff lands 2025-07-01, the second's 2027-01-01 → earliest.
    expect(s.cliff_date).toBe("2025-07-01");
  });

  it("a THEN program with the cliff on the head measures from the grant", () => {
    const result = run(
      "0.25 VEST OVER 12 months EVERY 1 month CLIFF 6 months THEN " +
        "0.75 VEST OVER 36 months EVERY 1 month",
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2025-03-01" }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBe("2025-07-01"); // grant + 6 months
  });

  it("a THEN tail cliff measures from the handoff", () => {
    // The head finishes 2026-01-01; the tail's 6-month cliff measures from that
    // handoff, not from the grant — and the head's first tranche is no phantom.
    const result = run(
      "0.25 VEST OVER 12 months EVERY 1 month THEN " +
        "0.75 VEST OVER 36 months EVERY 1 month CLIFF 6 months",
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800, asOf: "2025-03-01" }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBe("2026-07-01"); // handoff 2026-01-01 + 6 months
  });

  it("cliff_date follows the engine's month-end clamp", () => {
    // Grant on the 31st, 13-month cliff: addPeriod clamps Feb to the 28th.
    const result = run(
      "VEST OVER 48 months EVERY 1 month CLIFF 13 months",
      ctx({ grantDate: "2025-01-31", grantQuantity: 4800, asOf: "2025-06-01" }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBe("2026-02-28");
  });

  it("an impossible schedule has no cliff_date", () => {
    const result = run(
      "VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01 OVER 48 months EVERY 1 month",
      ctx({ grantDate: "2025-01-01", grantQuantity: 4800 }),
    );
    const s = computeSummary(result, 4800);
    expect(s.cliff_date).toBeNull();
  });

  it("an EARLIER OF cliff commits to its date floor and places a cliff_date (#251)", () => {
    // Closed-world resolution now commits an EARLIER OF cliff to its resolved arm:
    // `+12 months` off the 2025-01-01 start is the floor (the latest the cliff
    // could land), so the lump is placeable at 2026-01-01 regardless of the as-of —
    // pre-#251 this stayed unresolved and froze the whole grid.
    const dsl =
      "VEST OVER 48 months EVERY 1 month CLIFF EARLIER OF (+12 months, EVENT fda)";
    for (const asOf of ["2025-06-01", "2026-06-01"]) {
      const result = run(
        dsl,
        ctx({ grantDate: "2025-01-01", grantQuantity: 4800, events: {}, asOf }),
      );
      const s = computeSummary(result, 4800);
      expect(s.cliff_date).toBe("2026-01-01");
    }
  });

  it("percent_vested is 0 when grantQuantity is 0", () => {
    const result = run(
      "VEST OVER 12 months EVERY 1 month",
      ctx({ grantQuantity: 0 }),
    );
    const s = computeSummary(result, 0);
    expect(s.percent_vested).toBe(0);
  });

  it("rounds percent_vested to 4 decimal places", () => {
    // 1/3 = 0.3333... → 0.3333
    const result = run(
      "VEST OVER 3 months EVERY 1 month",
      ctx({
        grantQuantity: 100,
        asOf: "2025-02-01",
      }),
    );
    const s = computeSummary(result, 100);
    expect(s.total_vested).toBe(33);
    expect(s.percent_vested).toBe(0.33);
  });
});

describe("filterByWindow", () => {
  it("counts tranches within an inclusive window", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const { installments, total } = filterByWindow(
      result.vested,
      "2026-01-01",
      "2026-03-31",
    );
    // Cliff (25000) + Feb (2083) + Mar (2083) = 29166
    expect(installments.length).toBe(3);
    expect(total).toBe(29166);
  });

  it("returns empty for a window before any vesting", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const { installments, total } = filterByWindow(
      result.vested,
      "2025-06-01",
      "2025-12-31",
    );
    expect(installments).toHaveLength(0);
    expect(total).toBe(0);
  });

  it("window bounds are inclusive on both ends", () => {
    const result = run("VEST OVER 4 years EVERY 1 month CLIFF 1 year");
    const { installments, total } = filterByWindow(
      result.vested,
      "2026-01-01",
      "2026-01-01",
    );
    expect(installments).toHaveLength(1);
    expect(total).toBe(25000);
  });
});

// R2-B1: the template arm now carries UNRESOLVED installments for pending
// EVENT-based portions, so summary totals and breakdown both account for them.
describe("summary — pending template portions (R2-B1)", () => {
  const dsl =
    "0.75 VEST FROM DATE 2024-01-01 OVER 2 months EVERY 1 month PLUS " +
    "0.25 VEST FROM EVENT ipo OVER 2 months EVERY 1 month";
  const grant = {
    grant_date: "2024-01-01",
    grant_quantity: 4800,
    events: {},
  } as const;

  it("runAsOf: total_vested 3600, total_unvested 1200, fully_vested_date null", () => {
    const r = runAsOf(dsl, grant, "2026-01-01");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.total_vested).toBe(3600);
    expect(r.summary.total_unvested).toBe(1200);
    expect(r.summary.fully_vested_date).toBeNull();
  });

  it("runEvaluate: breakdown pending clause carries symbolic installments (1200)", () => {
    const r = runEvaluate(dsl, grant);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Two clauses: DATE-anchored (index 0) and EVENT-anchored (index 1).
    expect(r.breakdown).toHaveLength(2);
    const pendingClause = r.breakdown[1];
    const unresolvedAmount = pendingClause.installments
      .filter((i) => i.state === "UNRESOLVED")
      .reduce((a, i) => a + i.amount, 0);
    expect(unresolvedAmount).toBe(1200);
  });
});

// R2-B2: a THEN tail behind a pending head must carry its share claim as a
// symbolic installment — before the fix, only the head's half was counted.
describe("summary — pending THEN tail share claim (R2-B2)", () => {
  it("a THEN tail behind an unfired head keeps its claim in total_unvested", () => {
    // The #217 repro: 2,400 granted, both halves waiting on ipo; before the fix
    // only the head's 1,200 was counted anywhere.
    const result = run(
      "1/2 VEST FROM EVENT ipo OVER 12 months EVERY 1 month " +
        "THEN 1/2 VEST OVER 12 months EVERY 1 month",
      ctx({ grantQuantity: 2400, asOf: "2026-01-01" }),
    );
    expect(result.unresolved).toBe(2400);
    const s = computeSummary(result, 2400);
    expect(s.total_vested).toBe(0);
    expect(s.total_unvested).toBe(2400);
    expect(s.percent_vested).toBe(0);
    expect(s.fully_vested_date).toBeNull();
  });
});

// R2-B20: symbolic claims draw from one program-wide cumulative, so the as-of
// roll-up telescopes to what the allocator will deliver — not a sum of
// independent per-statement floors.
describe("summary — symbolic claims telescope program-wide (R2-B20)", () => {
  const thirds =
    "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month " +
    "PLUS 1/3 VEST FROM EVENT b OVER 1 month EVERY 1 month " +
    "PLUS 1/3 VEST FROM EVENT c OVER 1 month EVERY 1 month";

  it("three pending thirds of 100 tally 100 unresolved, not 99", () => {
    const r = runAsOf(
      thirds,
      { grant_date: "2024-01-01", grant_quantity: 100, events: {} },
      "2026-01-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unresolved).toBe(100);
    expect(r.summary.total_unvested).toBe(100);
    expect(r.summary.total_vested).toBe(0);
  });

  it("the pending-side total is the delivered total once the events fire", () => {
    const r = runAsOf(
      thirds,
      {
        grant_date: "2024-01-01",
        grant_quantity: 100,
        events: { a: "2024-03-10", b: "2024-03-10", c: "2024-03-10" },
      },
      "2026-01-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.total_vested).toBe(100);
    expect(r.unresolved).toBe(0);
  });

  it("mixed dated + pending conserves: 66 vested + 34 pending of 100", () => {
    const r = runAsOf(
      "1/3 VEST FROM EVENT a OVER 1 month EVERY 1 month PLUS 2/3 VEST OVER 2 months EVERY 1 month",
      { grant_date: "2024-01-01", grant_quantity: 100, events: {} },
      "2026-01-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.total_vested).toBe(66);
    expect(r.unresolved).toBe(34);
    expect(r.summary.total_vested + r.summary.total_unvested).toBe(100);
  });
});

// R2-B7: QUANTITY claims on the symbolic side cap at the grant, so the as-of
// roll-up can no longer report more unvested shares than the grant has — or
// any at all on a zero-share grant.
describe("summary — QUANTITY claims cap at the grant (R2-B7)", () => {
  it("150 VEST on a 100-share grant tallies 100 unresolved, not 150", () => {
    const r = runAsOf(
      "150 VEST FROM EVENT a OVER 2 months EVERY 1 month",
      { grant_date: "2024-01-01", grant_quantity: 100, events: {} },
      "2026-06-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unresolved).toBe(100);
    expect(r.summary.total_unvested).toBe(100);
    expect(r.summary.total_vested).toBe(0);
  });

  it("100 VEST on a zero-share grant tallies nothing", () => {
    const r = runAsOf(
      "100 VEST OVER 2 months EVERY 1 month",
      { grant_date: "2024-01-01", grant_quantity: 0, events: {} },
      "2026-06-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unresolved).toBe(0);
    expect(r.summary.total_unvested).toBe(0);
    expect(r.summary.percent_vested).toBe(0);
  });
});
