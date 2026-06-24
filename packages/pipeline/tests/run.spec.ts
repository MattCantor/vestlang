import { describe, it, expect, vi, afterEach } from "vitest";

// The degraded-breakdown AC needs `clauseBreakdown` to fall into its `[]` catch
// path. We mock just `evaluateClauseGroups` (the only call inside that try),
// gated on a flag so every other test runs against the real evaluator — the
// whole-program path goes through `@vestlang/recover`, which depends on the rest
// of this module, so a blanket mock would break it.
let failClauseBreakdown = false;
vi.mock("@vestlang/evaluator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vestlang/evaluator")>();
  return {
    ...actual,
    evaluateClauseGroups: (
      ...args: Parameters<typeof actual.evaluateClauseGroups>
    ) => {
      if (failClauseBreakdown) throw new Error("breakdown failed");
      return actual.evaluateClauseGroups(...args);
    },
  };
});

import {
  runEvaluate,
  runAsOf,
  runVestedBetween,
  runPersist,
  type GrantInput,
  type Summary,
} from "../src/index";
import { formatFinding } from "../src/findings";

const grant: GrantInput = {
  grant_date: "2025-01-01",
  grant_quantity: 1200,
};

const sumInstallments = (xs: { amount: number }[]) =>
  xs.reduce((a, x) => a + x.amount, 0);

describe("runEvaluate", () => {
  it("classifies a plain date-anchored schedule as a template", () => {
    const r = runEvaluate("VEST OVER 12 months EVERY 1 month", grant);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.resolution.status).toBe("template");
      expect(r.breakdown).toHaveLength(1);
    }
  });

  it("collapses a PLUS program to one schedule with no allocation finding", () => {
    const r = runEvaluate(
      "1/3 VEST OVER 12 months EVERY 1 month PLUS 1/3 VEST OVER 12 months EVERY 1 month PLUS 1/3 VEST OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.resolution.status).toBe("template");
      expect(r.view.findings).toEqual([]);
      // 33 + 33 + 34 across the three thirds — the whole grant, allocated once.
      expect(sumInstallments(r.view.installments)).toBe(100);
      expect(r.breakdown).toHaveLength(3);
    }
  });

  it("evaluates a THEN program without stranding the tail's breakdown", () => {
    // The repro from #143: a THEN tail can't resolve on its own, so the old
    // per-statement breakdown threw and sank the whole-program result. The chain
    // now resolves as one unit — head + tail land in a single breakdown entry.
    const r = runEvaluate(
      "0.25 VEST OVER 12 months EVERY 1 month THEN 0.75 VEST OVER 36 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 48 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.resolution.status).toBe("template");
      // 48 monthly tranches over the 12+36 chain, summing to the whole grant.
      expect(sumInstallments(r.view.installments)).toBe(48);
      // One THEN chain → one breakdown entry, carrying all 48 tranches.
      expect(r.breakdown).toHaveLength(1);
      expect(r.breakdown[0].installments).toHaveLength(48);
    }
  });

  it("keeps PLUS clauses and THEN chains as separate breakdown entries", () => {
    // An independent PLUS clause stands beside a two-segment THEN chain: two
    // groups, not three statements. The chain collapses to one entry; the PLUS
    // clause keeps its own.
    const r = runEvaluate(
      "0.5 VEST OVER 6 months EVERY 1 month THEN 0.25 VEST OVER 6 months EVERY 1 month PLUS 0.25 VEST OVER 6 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.breakdown).toHaveLength(2);
    }
  });

  it("reports a single over-allocation finding over the whole program", () => {
    const r = runEvaluate(
      "750 VEST OVER 12 months EVERY 1 month PLUS 750 VEST OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 1000 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.view.valid).toBe(false);
      expect(r.view.findings).toHaveLength(1);
      expect(r.view.findings[0].kind).toBe("over-allocation");
      expect(r.view.findings[0].severity).toBe("error");
    }
  });

  // #239: an over-allocating program (two 3/4 grids summing to 3/2) must keep its
  // diagnosis. Template recovery used to "rescue" the over-grant projection into a
  // clean template with a `recovered` block — contradictory, since the schedule is
  // simultaneously valid:false. The over-allocation finding survives and the
  // misleading rescue is gone.
  it("does not rescue an over-allocating program into a recovered template", () => {
    const r = runEvaluate(
      "3/4 VEST OVER 2 months EVERY 1 month PLUS 3/4 VEST OVER 2 months EVERY 1 month",
      { grant_date: "2024-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.valid).toBe(false);
    expect(r.view.findings.some((f) => f.kind === "over-allocation")).toBe(
      true,
    );
    expect(r.recovered).toBeUndefined();
  });

  it("surfaces an engine throw (the installment cap) as an evaluation error", () => {
    const r = runEvaluate("VEST OVER 1000000 months EVERY 1 month", grant);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ruleId).toBe("evaluation-error");
  });

  it("short-circuits on a syntax error", () => {
    const r = runEvaluate("not vestlang", grant);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ruleId).toBe("syntax-error");
  });
});

// #401 (explicit-gap): the per-clause breakdown floors each clause against its own
// cumulative, so on non-divisible fractions the per-clause amounts can sum to a
// share less than the collapsed headline. This surfaces that gap in-band as
// `breakdownResidual` (= Σheadline − Σbreakdown) plus a fixed `breakdownNote`,
// WITHOUT changing any amount. The real reconcile is deferred to #442.
describe("runEvaluate — breakdown residual (#401)", () => {
  const sumBreakdown = (b: { installments: { amount: number }[] }[]) =>
    b.reduce((a, c) => a + sumInstallments(c.installments), 0);

  // AC1: symbolic + resolved mix. The ipo clause is pending (33), the 2/3 clause
  // resolves (66); breakdown sums to 99 against a headline of 100.
  it("AC1: blocker case (symbolic + resolved) surfaces residual 1", () => {
    const r = runEvaluate(
      "1/3 VEST FROM EVENT ipo OVER 1 month EVERY 1 month PLUS " +
        "2/3 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sumInstallments(r.view.installments)).toBe(100);
    expect(sumBreakdown(r.breakdown)).toBe(99);
    expect(r.breakdownResidual).toBe(1);
    expect(typeof r.breakdownNote).toBe("string");
  });

  // AC2/AC4: plain divide that rescues to a single headline line, while the
  // breakdown keeps three per-clause floors (33 each). The residual is computed
  // against the user-visible (rescued) headline and still reads 1.
  it("AC2/AC4: rescue to one line keeps residual against the visible headline", () => {
    const r = runEvaluate(
      "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The headline rescues to one 100 line; the breakdown keeps three floors.
    expect(sumInstallments(r.view.installments)).toBe(100);
    expect(r.breakdown).toHaveLength(3);
    expect(sumBreakdown(r.breakdown)).toBe(99);
    expect(r.breakdownResidual).toBe(1);
  });

  // AC3: an even split ties, so the residual is 0 (still surfaced as a number,
  // and the note still rides along).
  it("AC3: even split ties at residual 0", () => {
    const r = runEvaluate(
      "0.5 VEST OVER 1 month EVERY 1 month PLUS " +
        "0.5 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sumInstallments(r.view.installments)).toBe(100);
    expect(sumBreakdown(r.breakdown)).toBe(100);
    expect(r.breakdownResidual).toBe(0);
    expect(typeof r.breakdownNote).toBe("string");
  });

  // AC7: over-allocation. Two 2/3 grids on a 100-share grant reach 4/3 — valid is
  // false. The residual is computed verbatim (66+67 headline − 66+66 breakdown =
  // 1), and the note is NOT a validity claim.
  it("AC7: residual is computed verbatim on a valid:false over-allocation", () => {
    const r = runEvaluate(
      "2/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "2/3 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.valid).toBe(false);
    expect(sumInstallments(r.view.installments)).toBe(133);
    expect(sumBreakdown(r.breakdown)).toBe(132);
    expect(r.breakdownResidual).toBe(1);
    // The note must not assert a correct grant total for an over-allocator.
    expect(r.breakdownNote).not.toMatch(/authoritative total/i);
    expect(r.breakdownNote).not.toMatch(/valid/i);
  });

  // AC4 as a property: across a spread of programs the residual is always a
  // non-negative integer, and is 0 exactly when the breakdown ties the headline.
  it("AC4: residual is a non-negative integer, 0 iff the breakdown ties", () => {
    const cases: { dsl: string; q: number }[] = [
      {
        dsl: "1/3 VEST OVER 1 month EVERY 1 month PLUS 2/3 VEST OVER 1 month EVERY 1 month",
        q: 100,
      },
      {
        dsl: "0.5 VEST OVER 1 month EVERY 1 month PLUS 0.5 VEST OVER 1 month EVERY 1 month",
        q: 100,
      },
      {
        dsl: "1/3 VEST OVER 1 month EVERY 1 month PLUS 1/3 VEST OVER 1 month EVERY 1 month PLUS 1/3 VEST OVER 1 month EVERY 1 month",
        q: 100,
      },
      { dsl: "VEST OVER 12 months EVERY 1 month", q: 1200 },
      {
        dsl: "2/3 VEST OVER 1 month EVERY 1 month PLUS 2/3 VEST OVER 1 month EVERY 1 month",
        q: 100,
      },
    ];
    for (const { dsl, q } of cases) {
      const r = runEvaluate(dsl, {
        grant_date: "2025-01-01",
        grant_quantity: q,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const residual = r.breakdownResidual;
      expect(residual).toBeDefined();
      if (residual === undefined) continue;
      expect(Number.isInteger(residual)).toBe(true);
      expect(residual).toBeGreaterThanOrEqual(0);
      const ties =
        sumInstallments(r.view.installments) === sumBreakdown(r.breakdown);
      expect(residual === 0).toBe(ties);
    }
  });

  // AC8: when the breakdown degrades to empty, both fields are omitted — there's
  // nothing to reconcile, and a residual equal to the whole grant would mislead.
  it("AC8: a degraded (empty) breakdown omits both fields", () => {
    failClauseBreakdown = true;
    try {
      const r = runEvaluate("VEST OVER 12 months EVERY 1 month", {
        grant_date: "2025-01-01",
        grant_quantity: 100,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown).toEqual([]);
      expect(r.breakdownResidual).toBeUndefined();
      expect(r.breakdownNote).toBeUndefined();
    } finally {
      failClauseBreakdown = false;
    }
  });
});

describe("runAsOf", () => {
  const eventGated = "VEST FROM EVENT ipo OVER 12 months EVERY 1 month";

  it("resolves an event-gated schedule once the event is supplied", () => {
    const r = runAsOf(
      eventGated,
      { ...grant, events: { ipo: "2020-01-01" } },
      "2030-01-01",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const summary: Summary = r.summary;
      expect(summary.total_vested).toBe(1200);
      expect(r.unresolved).toBe(0);
    }
  });

  it("leaves it unresolved when the event is missing", () => {
    const r = runAsOf(eventGated, grant, "2030-01-01");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.vested).toHaveLength(0);
      expect(r.unresolved).toBeGreaterThan(0);
    }
  });

  // Omitting the observation date means "as of today". The default is read once,
  // at the query call site — nowhere on the structure path — so fixing the system
  // clock pins both the reported `asOf` and where the tranches partition.
  describe("omitted as_of defaults to today", () => {
    afterEach(() => vi.useRealTimers());

    it("reports today's date and partitions tranches at it", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2025-09-15T12:00:00Z"));

      const r = runAsOf("VEST OVER 12 months EVERY 1 month", grant);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.asOf).toBe("2025-09-15");
        // The monthly grid runs 2025-02 … 2026-01. As of 2025-09-15, the tranches
        // through 2025-09 have vested and the rest are still unvested — the split
        // lands exactly on the defaulted date.
        for (const t of r.vested) {
          if (t.state === "RESOLVED") expect(t.date <= "2025-09-15").toBe(true);
        }
        for (const t of r.unvested) {
          if (t.state === "RESOLVED") expect(t.date > "2025-09-15").toBe(true);
        }
        expect(r.vested.length).toBeGreaterThan(0);
        expect(r.unvested.length).toBeGreaterThan(0);
      }
    });
  });
});

describe("runVestedBetween", () => {
  it("rejects an inverted window", () => {
    const r = runVestedBetween(
      "VEST OVER 12 months EVERY 1 month",
      grant,
      "2025-12-31",
      "2025-01-01",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.ruleId).toBe("evaluation-error");
  });

  it("returns the resolved tranches inside the window", () => {
    const r = runVestedBetween(
      "VEST OVER 12 months EVERY 1 month",
      grant,
      "2025-01-01",
      "2025-12-31",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.tranches_in_window).toBeGreaterThan(0);
      expect(r.vested_in_window).toBe(r.tranches_in_window * 100);
    }
  });
});

// R2-B3 / #255: a pending-head chain with a tail event cliff now stores as a
// compound template (a contingent start + the tail's event_condition), not an
// unstorable event-anchored cliff.
describe("runEvaluate — pending-head chain with a tail event cliff (R2-B3/#255)", () => {
  it("stores the tail's event hold as a compound template", () => {
    const r = runEvaluate(
      "1/2 VEST FROM EVENT ipo OVER 12 months EVERY 1 month " +
        "THEN 1/2 VEST OVER 12 months EVERY 1 month CLIFF EVENT fda",
      { grant_date: "2025-01-01", grant_quantity: 2400 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.interchange.status).toBe("template");
  });
});

// R2-B14 / #255: a gated event cliff stores as a synthetic event_condition (the
// gate captured in its recipe), so the schedule is a storable template.
describe("runEvaluate — gated event cliff stores as a template (R2-B14/#255)", () => {
  it("stores the gated event hold as a template", () => {
    const r = runEvaluate(
      "VEST OVER 48 months EVERY 1 month CLIFF EVENT ipo AFTER DATE 2025-01-01",
      { grant_date: "2024-01-01", grant_quantity: 48 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.interchange.status).toBe("template");
  });
});

// R2-B2: a pending-head THEN chain's breakdown must carry the whole chain's
// claim, not just the head's share.
describe("runEvaluate — pending THEN chain breakdown (R2-B2)", () => {
  it("a pending-head THEN chain's breakdown entry carries the whole chain's claim", () => {
    const r = runEvaluate(
      "1/2 VEST FROM EVENT ipo OVER 12 months EVERY 1 month " +
        "THEN 1/2 VEST OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 2400 },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.breakdown).toHaveLength(1);
      expect(sumInstallments(r.breakdown[0].installments)).toBe(2400);
    }
  });
});

// A grant can carry both a stand-in event (the engine invents one when a start
// is too complex to store — here the `LATER OF(a, b)` half) and a user event
// the cap-table author happened to name `evt_1`. The two used to collide: the
// stand-in was also named `evt_1`, so firing the user's event vested the
// contingent half that was still meant to be waiting — over-vesting the grant.
// Moving stand-ins into the `evt:<n>` namespace (a name no DSL identifier can
// spell) makes the collision impossible.
describe("runEvaluate — a user event named evt_1 no longer shadows a stand-in", () => {
  it("vests only the settled half; the contingent half stays unresolved", () => {
    const r = runEvaluate(
      "1/2 VEST FROM LATER OF(EVENT a, EVENT b) OVER 4 months EVERY 1 month " +
        "PLUS 1/2 VEST FROM EVENT evt_1 OVER 4 months EVERY 1 month",
      {
        grant_date: "2026-01-01",
        grant_quantity: 1000,
        // The user's own event fires; the LATER OF anchors (a, b) do not.
        events: { evt_1: "2026-06-01" },
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const byState = (state: string) =>
      r.view.installments
        .filter((i) => i.state === state)
        .reduce((a, i) => a + i.amount, 0);

    const resolved = byState("RESOLVED");
    const unresolved = byState("UNRESOLVED");

    // Half vests (the user's evt_1 half); the contingent LATER OF half waits.
    expect(resolved).toBe(500);
    expect(unresolved).toBe(500);
    // No part of the grant is double-counted or lost.
    expect(resolved + unresolved).toBe(1000);

    // The hold-up is the LATER OF's unfired anchors, not the user's evt_1 — all
    // pending, nothing dead.
    expect(r.view.pendingBlockers).toEqual([
      {
        type: "UNRESOLVED_SELECTOR",
        selector: "LATER_OF",
        blockers: [
          { type: "EVENT_NOT_YET_OCCURRED", event: "a" },
          { type: "EVENT_NOT_YET_OCCURRED", event: "b" },
        ],
      },
    ]);
    expect(r.view.deadBlockers).toEqual([]);
  });
});

// The as-of read tools used to sum the resolved tranches with no signal, so an
// over-allocating program quietly reported more than 100% vested with a clean
// completion date. The validity channel — `valid` + `findings` — now rides along:
// the partition is still returned (annotate, don't certify), but flagged.
describe("runAsOf — validity channel on an over-allocating program", () => {
  // Two 0.6 grids on the same grant total 120% (6/5). They resolve to bare dated
  // events (two overlapping absolute grids can't be one template), so this is the
  // events-only arm.
  const overAllocates =
    "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month PLUS " +
    "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";
  const grant: GrantInput = {
    grant_date: "2025-01-01",
    grant_quantity: 1200,
  };

  it("flags valid:false with the over-allocation finding (events-only arm)", () => {
    const r = runAsOf(overAllocates, grant, "2027-01-01");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toBe(false);
    expect(r.findings).toHaveLength(1);
    const [f] = r.findings;
    expect(f.kind).toBe("over-allocation");
    expect(f.severity).toBe("error");
    // The rendered sentence is self-consistent (formatted by the same helper the
    // evaluate surface uses) and pins the exact human string.
    expect(f.message).toBe(formatFinding(f));
    expect(f.message).toBe(
      "over-allocates the grant to 120% (6/5) — not a valid schedule",
    );
  });

  // The other arm: a single absolute count exceeding the grant stays one clean
  // template, so this proves the channel works on the template arm too. (A single
  // fraction can't over-allocate — the parser caps a portion at ≤ 1.)
  it("flags valid:false with the over-allocation finding (template arm)", () => {
    const r = runAsOf(
      "1500 VEST OVER 12 months EVERY 1 month",
      grant,
      "2027-01-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toBe(false);
    expect(r.findings).toHaveLength(1);
    const [f] = r.findings;
    expect(f.kind).toBe("over-allocation");
    expect(f.message).toBe(formatFinding(f));
    expect(f.message).toBe(
      "over-allocates the grant to 125% (5/4) — not a valid schedule",
    );
  });

  // Fully vested past the end: the numbers stay honest — percent reads above 1
  // (no clamp), totals are the raw sum — and only the completion date is dropped,
  // since it would otherwise assert a false "the grant finished vesting".
  it("summary stays honest after full vest, only fully_vested_date suppressed", () => {
    const r = runAsOf(overAllocates, grant, "2027-01-01");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.percent_vested).toBe(1.2);
    expect(r.summary.total_vested).toBe(1440);
    expect(r.summary.fully_vested_date).toBeNull();
  });

  // The same program viewed mid-vesting, where a clamp-to-1 would have been a
  // no-op anyway: percent reads below 1, the completion date is still null, and
  // validity is independent of how far vesting has progressed. (Pins that the
  // guard isn't a `=== 1.0` assignment.)
  it("summary stays honest mid-vesting; validity doesn't depend on progress", () => {
    const r = runAsOf(overAllocates, grant, "2025-06-15");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toBe(false);
    expect(r.summary.percent_vested).toBe(0.5);
    expect(r.summary.percent_vested).toBeLessThan(1);
    expect(r.summary.total_vested).toBe(600);
    expect(r.summary.fully_vested_date).toBeNull();
  });
});

describe("runVestedBetween — validity channel", () => {
  it("flags valid:false but keeps the window sum unclamped", () => {
    const r = runVestedBetween(
      "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month PLUS " +
        "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 1200 },
      "2025-01-01",
      "2027-01-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toBe(false);
    expect(r.findings.some((f) => f.kind === "over-allocation")).toBe(true);
    // The whole 1440 shares fall inside the window — the real sum, not clamped to
    // the grant.
    expect(r.vested_in_window).toBe(1440);
  });
});

// A normal program loses nothing: valid, no findings, and the summary reads
// exactly as before.
describe("runAsOf — a valid program is unchanged", () => {
  it("reports valid:true, empty findings, and a real completion date", () => {
    const r = runAsOf(
      "VEST OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 1200 },
      "2027-01-01",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valid).toBe(true);
    expect(r.findings).toEqual([]);
    expect(r.summary.percent_vested).toBe(1);
    expect(r.summary.fully_vested_date).toBe("2026-01-01");
  });
});

// The three read surfaces and the write path agree about validity. The as-of
// tools have no template recovery (only evaluate does), so this also pins that
// recovery and the as-of path still coincide — they do, because recovery declines
// on an error finding.
describe("read surfaces agree with evaluate on validity", () => {
  const overAllocates =
    "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month PLUS " +
    "0.6 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month";
  const grant: GrantInput = {
    grant_date: "2025-01-01",
    grant_quantity: 1200,
  };

  it("an over-allocating program is invalid everywhere; persist refuses", () => {
    const ev = runEvaluate(overAllocates, grant);
    const asof = runAsOf(overAllocates, grant, "2027-01-01");
    const between = runVestedBetween(
      overAllocates,
      grant,
      "2025-01-01",
      "2027-01-01",
    );
    expect(ev.ok && asof.ok && between.ok).toBe(true);
    if (!ev.ok || !asof.ok || !between.ok) return;
    expect(ev.view.valid).toBe(false);
    expect(asof.valid).toBe(false);
    expect(between.valid).toBe(false);

    // The write path keeps refusing where the reads only annotate.
    const persisted = runPersist({ dsl: overAllocates, ...grant });
    expect(persisted.ok).toBe(false);
    if (!persisted.ok) {
      expect(persisted.error.ruleId).toBe("persist-not-storable");
    }
  });

  it("a valid program evaluate rescues to a template reads valid on all surfaces", () => {
    // Two overlapping absolute grids summing to 100% — events-only, but their
    // projection collapses back to a single THEN-chain template, so evaluate
    // rescues it. The as-of path has no recovery, yet still agrees it's valid,
    // because neither path produces an error finding.
    const recoverable =
      "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS " +
      "0.5 VEST FROM DATE 2024-03-01 OVER 4 months EVERY 1 month";
    const recoverGrant: GrantInput = {
      grant_date: "2024-01-01",
      grant_quantity: 800,
    };
    const ev = runEvaluate(recoverable, recoverGrant);
    const asof = runAsOf(recoverable, recoverGrant, "2027-01-01");
    const between = runVestedBetween(
      recoverable,
      recoverGrant,
      "2024-01-01",
      "2027-01-01",
    );
    expect(ev.ok && asof.ok && between.ok).toBe(true);
    if (!ev.ok || !asof.ok || !between.ok) return;
    // evaluate did rescue it (the proof the two paths really differ here).
    expect(ev.recovered).toBeDefined();
    expect(ev.view.valid).toBe(true);
    expect(asof.valid).toBe(true);
    expect(asof.findings).toEqual([]);
    expect(between.valid).toBe(true);
  });
});
