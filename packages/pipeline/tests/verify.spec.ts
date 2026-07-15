import { describe, it, expect } from "vitest";
import {
  verifyObservations,
  type VerifyInput,
  type Observation,
} from "../src/verify";

// A monthly grid over 1000 shares in 10 installments — 100 a month, first on
// 2025-02-01, last on 2025-11-01. Predicted vested is 800 by 2025-09-01, 900 by
// 2025-10-01 (unvested 200 then 100).
const monthly1000: Omit<VerifyInput, "observations"> = {
  dsl: "VEST OVER 10 months EVERY 1 month",
  grant_date: "2025-01-01",
  grant_quantity: 1000,
};

// A 12-month grid over 1200 shares — 100 a month, 2025-02-01 through 2026-01-01.
const monthly1200: Omit<VerifyInput, "observations"> = {
  dsl: "VEST OVER 12 months EVERY 1 month",
  grant_date: "2025-01-01",
  grant_quantity: 1200,
};

const verify = (
  base: Omit<VerifyInput, "observations">,
  observations: Observation[],
  extra: Partial<VerifyInput> = {},
) => verifyObservations({ ...base, ...extra, observations });

describe("verifyObservations — a matching schedule", () => {
  it("passes when every balance lands on the prediction, reporting both predicted figures", () => {
    const r = verify(monthly1200, [
      { kind: "balance", date: "2025-04-01", vested: 300, unvested: 900 },
      { kind: "balance", date: "2025-08-01", vested: 700, unvested: 500 },
      { kind: "balance", date: "2025-12-01", vested: 1100, unvested: 100 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches).toBe(true);
    expect(r.worstGap).toBe(0);
    for (const row of r.rows) {
      expect(row.kind).toBe("balance");
      if (row.kind !== "balance") continue;
      // Both predictions are present on every row, and each check is clean.
      expect(typeof row.predictedVested).toBe("number");
      expect(typeof row.predictedUnvested).toBe("number");
      for (const c of row.checks) {
        expect(c.withinTolerance).toBe(true);
        expect(c.gap).toBe(0);
      }
    }
  });

  it("reports both predicted figures even when only one is observed", () => {
    const r = verify(monthly1200, [
      { kind: "balance", date: "2025-04-01", vested: 300 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok || r.rows[0].kind !== "balance") return;
    expect(r.rows[0].predictedVested).toBe(300);
    expect(r.rows[0].predictedUnvested).toBe(900);
    expect(r.rows[0].checks).toHaveLength(1);
  });
});

describe("verifyObservations — the gap denominator is the grant, everywhere", () => {
  // A vested figure 50 shares over a 1000-share grant is 5% of the grant no matter
  // the date — including late, where the remaining unvested is tiny and a
  // percent-of-expected reading would explode.
  it("measures every gap as a constant percent of grant, at an early and a late date", () => {
    const early = verify(monthly1000, [
      { kind: "balance", date: "2025-06-01", vested: 550 }, // predicted 500, +50
    ]);
    const late = verify(monthly1000, [
      { kind: "balance", date: "2025-10-01", unvested: 150 }, // predicted 100, +50
    ]);
    expect(early.ok && late.ok).toBe(true);
    if (!early.ok || !late.ok) return;
    const earlyCheck = (
      early.rows[0] as { checks: { delta: number; gap: number }[] }
    ).checks[0];
    const lateCheck = (
      late.rows[0] as { checks: { delta: number; gap: number }[] }
    ).checks[0];
    expect(earlyCheck.delta).toBe(50);
    expect(earlyCheck.gap).toBe(5);
    // Same 50-share error against a tiny expected-unvested of 100 is still 5% of
    // grant, not 50% of the expectation.
    expect(lateCheck.delta).toBe(50);
    expect(lateCheck.gap).toBe(5);
  });

  it("signs the delta by direction: over-observation positive, under negative", () => {
    const over = verify(monthly1000, [
      { kind: "balance", date: "2025-09-01", vested: 850 }, // predicted 800
    ]);
    const under = verify(monthly1000, [
      { kind: "balance", date: "2025-09-01", vested: 750 },
    ]);
    if (!over.ok || !under.ok) return;
    expect(
      (over.rows[0] as { checks: { delta: number }[] }).checks[0].delta,
    ).toBe(50);
    expect(
      (under.rows[0] as { checks: { delta: number }[] }).checks[0].delta,
    ).toBe(-50);
  });
});

describe("verifyObservations — tolerance", () => {
  // One 50-share miss over 1000 shares = 5% = 50 shares, so it straddles chosen
  // percent and share-count thresholds in opposite directions.
  const off50: Observation[] = [
    { kind: "balance", date: "2025-09-01", vested: 850 },
  ];

  it("passes a percent tolerance yet fails a tighter share-count one", () => {
    const percent6 = verify(monthly1000, off50, {
      tolerance: { kind: "percent", value: 6 },
    });
    const shares40 = verify(monthly1000, off50, {
      tolerance: { kind: "shares", value: 40 },
    });
    if (!percent6.ok || !shares40.ok) return;
    expect(percent6.matches).toBe(true);
    expect(shares40.matches).toBe(false);
  });

  it("passes a share-count tolerance yet fails a tighter percent one", () => {
    const shares60 = verify(monthly1000, off50, {
      tolerance: { kind: "shares", value: 60 },
    });
    const percent4 = verify(monthly1000, off50, {
      tolerance: { kind: "percent", value: 4 },
    });
    if (!shares60.ok || !percent4.ok) return;
    expect(shares60.matches).toBe(true);
    expect(percent4.matches).toBe(false);
  });

  it("defaults to 5 percent of grant when tolerance is omitted", () => {
    const r = verify(monthly1000, off50);
    if (!r.ok) return;
    expect(r.tolerance).toEqual({ kind: "percent", value: 5 });
    // Exactly 5% sits on the boundary and is admitted.
    expect(r.matches).toBe(true);
  });
});

describe("verifyObservations — balance figures are checked independently", () => {
  it("checks a vested-only figure against predicted vested", () => {
    const r = verify(monthly1000, [
      { kind: "balance", date: "2025-09-01", vested: 800 },
    ]);
    if (!r.ok || r.rows[0].kind !== "balance") return;
    expect(r.rows[0].checks).toHaveLength(1);
    expect(r.rows[0].checks[0].figure).toBe("vested");
  });

  it("checks an unvested-only figure against predicted unvested", () => {
    const r = verify(monthly1000, [
      { kind: "balance", date: "2025-09-01", unvested: 200 },
    ]);
    if (!r.ok || r.rows[0].kind !== "balance") return;
    expect(r.rows[0].checks).toHaveLength(1);
    expect(r.rows[0].checks[0].figure).toBe("unvested");
  });

  it("fails only the wrong figure when the two disagree, and fails the row", () => {
    // Predicted 800 / 200 at 2025-09-01: the vested figure is right, the unvested
    // one is 150 shares (15% of grant) too high.
    const r = verify(monthly1000, [
      { kind: "balance", date: "2025-09-01", vested: 800, unvested: 350 },
    ]);
    if (!r.ok || r.rows[0].kind !== "balance") return;
    const vested = r.rows[0].checks.find((c) => c.figure === "vested")!;
    const unvested = r.rows[0].checks.find((c) => c.figure === "unvested")!;
    expect(vested.withinTolerance).toBe(true);
    expect(unvested.withinTolerance).toBe(false);
    expect(r.rows[0].passes).toBe(false);
    expect(r.matches).toBe(false);
  });
});

describe("verifyObservations — tranche semantics", () => {
  it("passes a tranche that matches a predicted installment's date and amount", () => {
    const r = verify(monthly1000, [
      { kind: "tranche", date: "2025-02-01", amount: 100 },
    ]);
    if (!r.ok || r.rows[0].kind !== "tranche") return;
    expect(r.rows[0].check.predicted).toBe(100);
    expect(r.rows[0].passes).toBe(true);
  });

  it("sums same-date tranche observations before comparing", () => {
    const r = verify(monthly1000, [
      { kind: "tranche", date: "2025-03-01", amount: 40 },
      { kind: "tranche", date: "2025-03-01", amount: 60 },
    ]);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    if (r.rows[0].kind !== "tranche") return;
    expect(r.rows[0].check.observed).toBe(100);
    expect(r.rows[0].check.predicted).toBe(100);
    expect(r.rows[0].passes).toBe(true);
  });

  it("fails an off-date tranche and points at the nearest installment, ties going earlier", () => {
    // 2025-02-15 sits exactly between the 2025-02-01 and 2025-03-01 installments;
    // the earlier one wins the tie.
    const r = verify(monthly1000, [
      { kind: "tranche", date: "2025-02-15", amount: 100 },
    ]);
    if (!r.ok || r.rows[0].kind !== "tranche") return;
    expect(r.rows[0].check.withinTolerance).toBe(false);
    expect(r.rows[0].passes).toBe(false);
    expect(r.rows[0].nearest).toEqual({ date: "2025-02-01", amount: 100 });
  });

  it("omits the nearest pointer when the schedule has no dated installments", () => {
    const r = verify(
      {
        dsl: "VEST FROM EVENT ipo OVER 12 months EVERY 1 month",
        grant_date: "2025-01-01",
        grant_quantity: 1200,
      },
      [{ kind: "tranche", date: "2025-06-01", amount: 100 }],
    );
    if (!r.ok || r.rows[0].kind !== "tranche") return;
    expect(r.rows[0].passes).toBe(false);
    expect(r.rows[0].nearest).toBeUndefined();
  });
});

describe("verifyObservations — mixed observation sets", () => {
  it("verifies balances and tranches together and only matches when every check passes", () => {
    const good = verify(monthly1200, [
      { kind: "balance", date: "2025-06-01", vested: 500 },
      { kind: "tranche", date: "2025-02-01", amount: 100 },
    ]);
    if (!good.ok) return;
    expect(good.rows).toHaveLength(2);
    expect(good.matches).toBe(true);

    // Flip the tranche amount out of tolerance; the whole set no longer matches
    // even though the balance still does.
    const bad = verify(monthly1200, [
      { kind: "balance", date: "2025-06-01", vested: 500 },
      { kind: "tranche", date: "2025-02-01", amount: 400 },
    ]);
    if (!bad.ok) return;
    expect(bad.matches).toBe(false);
  });
});

describe("verifyObservations — pending gates", () => {
  const gated = "VEST FROM EVENT ipo OVER 12 months EVERY 1 month";

  it("verifies a schedule waiting on an unfired event, counting gated shares as unvested", () => {
    const r = verify(
      { dsl: gated, grant_date: "2025-01-01", grant_quantity: 1200 },
      [{ kind: "balance", date: "2026-06-01", vested: 0, unvested: 1200 }],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches).toBe(true);
    expect(r.unresolved).toBe(1200);
    expect(r.impossible).toBe(0);
    if (r.rows[0].kind === "balance") {
      expect(r.rows[0].predictedVested).toBe(0);
      expect(r.rows[0].predictedUnvested).toBe(1200);
    }
  });

  it("relays the evaluator's absence assumptions", () => {
    const r = verify(
      {
        dsl: "VEST FROM EARLIER OF (DATE 2026-06-01, EVENT ipo) OVER 12 months EVERY 1 month",
        grant_date: "2025-01-01",
        grant_quantity: 1200,
      },
      [{ kind: "balance", date: "2026-01-01", vested: 0 }],
    );
    if (!r.ok) return;
    expect(r.absenceAssumptions.length).toBeGreaterThan(0);
    expect(r.absenceAssumptions[0].eventId).toBe("ipo");
    expect(r.absenceAssumptions[0].message).toContain("ipo");
  });

  it("resolves to dated history once the gate is fired", () => {
    const r = verify(
      { dsl: gated, grant_date: "2025-01-01", grant_quantity: 1200 },
      [
        { kind: "tranche", date: "2025-02-01", amount: 100 },
        { kind: "balance", date: "2025-06-01", vested: 500 },
      ],
      { events: { ipo: "2025-01-01" } },
    );
    if (!r.ok) return;
    expect(r.unresolved).toBe(0);
    expect(r.matches).toBe(true);
  });
});

describe("verifyObservations — un-gradeable inputs refuse, bad-but-evaluable ones grade", () => {
  it("refuses an over-allocating program, naming the over-allocation and returning no rows", () => {
    const r = verify(
      {
        dsl:
          "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month PLUS " +
          "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month",
        grant_date: "2025-01-01",
        grant_quantity: 1200,
      },
      [{ kind: "balance", date: "2026-01-01", vested: 1000 }],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("verify-over-allocation");
    expect(r.error.message).toMatch(/over-allocat/i);
  });

  it("refuses unparseable DSL with a parse error", () => {
    const r = verify(
      monthly1000,
      [{ kind: "balance", date: "2025-06-01", vested: 1 }],
      {
        dsl: "not vestlang",
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("syntax-error");
  });

  it("refuses a grant quantity below one", () => {
    const r = verify(
      monthly1000,
      [{ kind: "balance", date: "2025-06-01", vested: 1 }],
      {
        grant_quantity: 0,
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("verify-invalid-grant-quantity");
  });

  it("refuses an empty observation set", () => {
    const r = verify(monthly1000, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.ruleId).toBe("verify-no-observations");
  });

  it("grades an evaluable never-vesting schedule, disclosing its impossible shares", () => {
    // An unsatisfiable date window vests nothing but still evaluates; it is graded,
    // and the never-vesting shares surface in the impossible total.
    const r = verify(
      {
        dsl: "VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01 OVER 12 months EVERY 1 month",
        grant_date: "2025-01-01",
        grant_quantity: 1200,
      },
      [{ kind: "balance", date: "2026-01-01", vested: 0, unvested: 1200 }],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.impossible).toBe(1200);
    expect(r.matches).toBe(true);
  });
});

describe("verifyObservations — aggregates without a score", () => {
  it("reports worst and mean absolute gap over the checks, not the rows", () => {
    // One balance row carrying two checks: vested +50 (5% gap) and unvested +30
    // (3% gap). The aggregates run over the two checks — worst 5, mean 4 — not over
    // the single row.
    const r = verify(monthly1000, [
      { kind: "balance", date: "2025-09-01", vested: 850, unvested: 170 },
    ]);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
    expect(r.worstGap).toBe(5);
    expect(r.meanGap).toBe(4);
  });

  it("carries no composite score field", () => {
    const r = verify(monthly1000, [
      { kind: "balance", date: "2025-09-01", vested: 800 },
    ]);
    expect(r).not.toHaveProperty("score");
  });
});
