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
      expect(r.view.resolvesTo.status).toBe("template");
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
      expect(r.view.resolvesTo.status).toBe("template");
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
      expect(r.view.resolvesTo.status).toBe("template");
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

  it("gives the same over-allocation verdict at a zero-share grant as at a real one", () => {
    // 0.6 + 0.6 = 120% of the grant. The ratio is grant-independent, so evaluate
    // must flag it at grant 0 exactly as it does at a real grant — not report a
    // spurious valid:true just because there are no shares to divide against.
    const repro =
      "0.6 VEST OVER 12 months EVERY 1 month PLUS 0.6 VEST OVER 12 months EVERY 1 month";
    const expected = {
      kind: "over-allocation",
      severity: "error",
      sum: { numerator: 6, denominator: 5 },
      path: ["Program"],
    };

    for (const grant_quantity of [0, 100]) {
      const r = runEvaluate(repro, {
        grant_date: "2025-01-01",
        grant_quantity,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.view.valid).toBe(false);
      expect(r.view.findings).toHaveLength(1);
      expect(r.view.findings[0]).toMatchObject(expected);
    }
  });

  it("raises no over-allocation for an over-claiming QUANTITY at a zero-share grant", () => {
    // 1500 of a 0-share grant lowers to nothing (QUANTITY → ZERO), so the sum is
    // within the grant. The over-allocation check must not misfire on it — only
    // pure PORTION amounts can exceed the grant when there are no shares.
    const r = runEvaluate("1500 VEST OVER 12 months EVERY 1 month", {
      grant_date: "2025-01-01",
      grant_quantity: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.valid).toBe(true);
    expect(r.view.findings.some((f) => f.kind === "over-allocation")).toBe(
      false,
    );
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

// #442: the per-clause breakdown is a PARTITION of the one headline allocation —
// each clause's slice of the single-cumulative round-down — so it sums to the
// headline by construction (no residual, no marker). A clause adopts the headline's
// odd-share placement rather than re-flooring against its own fresh cumulative.
describe("runEvaluate — breakdown is a partition of the headline (#442)", () => {
  const sumBreakdown = (b: { installments: { amount: number }[] }[]) =>
    b.reduce((a, c) => a + sumInstallments(c.installments), 0);
  const perEntry = (b: { installments: { amount: number }[] }[]) =>
    b.map((c) => sumInstallments(c.installments));

  // AC1: a corpus of fully-resolved programs — the breakdown sums to the headline,
  // including the canonical non-divisible 1/3 PLUS 1/3 PLUS 1/3 of 100.
  it("AC1: by-construction sum across resolved programs", () => {
    const cases: { dsl: string; q: number }[] = [
      { dsl: "VEST OVER 12 months EVERY 1 month", q: 1200 },
      {
        dsl: "1/3 VEST OVER 1 month EVERY 1 month PLUS 1/3 VEST OVER 1 month EVERY 1 month PLUS 1/3 VEST OVER 1 month EVERY 1 month",
        q: 100,
      },
      {
        dsl: "0.25 VEST OVER 12 months EVERY 1 month THEN 0.75 VEST OVER 36 months EVERY 1 month",
        q: 48,
      },
      { dsl: "VEST OVER 4 years EVERY 1 month CLIFF 1 year", q: 100000 },
      {
        dsl: "VEST FROM EVENT ipo",
        q: 1000,
      },
    ];
    for (const { dsl, q } of cases) {
      const r = runEvaluate(dsl, {
        grant_date: "2025-01-01",
        grant_quantity: q,
        events: { ipo: "2025-06-01" },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(sumBreakdown(r.breakdown)).toBe(
        sumInstallments(r.view.installments),
      );
    }
  });

  // AC2: the odd share lands per the headline — 33/33/34, not 33/33/33.
  it("AC2: odd share lands per the headline (33/33/34)", () => {
    const r = runEvaluate(
      "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.breakdown).toHaveLength(3);
    expect(perEntry(r.breakdown)).toEqual([33, 33, 34]);
    expect(sumBreakdown(r.breakdown)).toBe(100);
    expect(sumInstallments(r.view.installments)).toBe(100);
  });

  // AC3: a resolved clause beside a pending-event clause still sums (counting the
  // symbolic/UNRESOLVED amounts), and the pending clause keeps its blockers.
  it("AC3: by-construction sum, partly pending / blocked", () => {
    const r = runEvaluate(
      "3/4 VEST OVER 12 months EVERY 1 month PLUS " +
        "1/4 VEST FROM EVENT ipo OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sumBreakdown(r.breakdown)).toBe(
      sumInstallments(r.view.installments),
    );
    // The pending (ipo) clause is entry 1; its blockers are non-empty.
    expect(r.breakdown[1].pendingBlockers.length).toBeGreaterThan(0);

    // A pending-head THEN chain: the whole chain's claim still ties.
    const chain = runEvaluate(
      "1/3 VEST FROM EVENT ipo OVER 1 month EVERY 1 month " +
        "THEN 2/3 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(chain.ok).toBe(true);
    if (!chain.ok) return;
    expect(chain.breakdown).toHaveLength(1);
    expect(sumBreakdown(chain.breakdown)).toBe(
      sumInstallments(chain.view.installments),
    );
  });

  // AC4: an all-void program does NOT sum to 0 — each void statement draws its full
  // claim onto an IMPOSSIBLE installment, so the breakdown ties at the CLAIMED total.
  it("AC4: all-void ties at the claimed total, per clause", () => {
    const split = runEvaluate(
      "2/3 VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month PLUS " +
        "1/3 VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01 OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    // The headline carries [66, 34], NOT 0; the breakdown matches per clause.
    expect(split.view.installments.map((i) => i.amount)).toEqual([66, 34]);
    expect(perEntry(split.breakdown)).toEqual([66, 34]);
    expect(sumBreakdown(split.breakdown)).toBe(100);
    // The dead clauses still carry their blockers.
    expect(split.breakdown[0].deadBlockers.length).toBeGreaterThan(0);

    const single = runEvaluate(
      "VEST FROM DATE 2025-06-01 BEFORE DATE 2025-01-01 OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 1200 },
    );
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    expect(perEntry(single.breakdown)).toEqual([1200]);
    expect(sumBreakdown(single.breakdown)).toBe(1200);
  });

  // AC5: an over-allocating schedule keeps its warning AND the breakdown ties to the
  // (illegal) over-allocating headline. No residual/note appears.
  it("AC5: over-allocating schedule still surfaces the warning, breakdown ties", () => {
    const twoThirds = runEvaluate(
      "2/3 VEST OVER 1 month EVERY 1 month PLUS " +
        "2/3 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(twoThirds.ok).toBe(true);
    if (!twoThirds.ok) return;
    expect(twoThirds.view.valid).toBe(false);
    expect(
      twoThirds.view.findings.some((f) => f.kind === "over-allocation"),
    ).toBe(true);
    expect(perEntry(twoThirds.breakdown)).toEqual([66, 67]);
    expect(sumBreakdown(twoThirds.breakdown)).toBe(133);
    expect(sumInstallments(twoThirds.view.installments)).toBe(133);
    // The markers are gone.
    expect("breakdownResidual" in twoThirds).toBe(false);
    expect("breakdownNote" in twoThirds).toBe(false);

    const sevenFifty = runEvaluate(
      "750 VEST OVER 12 months EVERY 1 month PLUS 750 VEST OVER 12 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 1000 },
    );
    expect(sevenFifty.ok).toBe(true);
    if (!sevenFifty.ok) return;
    expect(sevenFifty.view.valid).toBe(false);
    expect(sumBreakdown(sevenFifty.breakdown)).toBe(
      sumInstallments(sevenFifty.view.installments),
    );
  });

  // AC6: a recovered #43-style schedule attributes to the ORIGINAL author clauses
  // (one entry each), not the synthesized THEN-chain's segments.
  it("AC6: recovered schedule attributes to original clauses", () => {
    const r = runEvaluate(
      "0.5 VEST FROM DATE 2024-01-01 OVER 4 months EVERY 1 month PLUS " +
        "0.5 VEST FROM DATE 2024-03-01 OVER 4 months EVERY 1 month",
      { grant_date: "2024-01-01", grant_quantity: 800 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.recovered).toBeDefined();
    // One entry per original clause, each its full 0.5 of 800 — a total-preserving
    // mis-split ([800, 0]) would fail this.
    expect(perEntry(r.breakdown)).toEqual([400, 400]);
    expect(sumBreakdown(r.breakdown)).toBe(
      sumInstallments(r.view.installments),
    );
  });

  // AC12: a clause that rounds entirely to zero still yields one breakdown entry
  // (installments: []), not a missing entry — the seed-over-the-whole-program
  // invariant against allocateEvents dropping amount===0 rows.
  it("AC12: a zero-rounding clause keeps an empty entry; sum still ties", () => {
    // 1 share over two clauses: the single-cumulative allocator gives the share to
    // the second clause (the first event rounds to 0 and drops), so the first
    // clause rounds entirely to zero — but it KEEPS its entry (installments: []).
    const r = runEvaluate(
      "0.5 VEST OVER 1 month EVERY 1 month PLUS 0.5 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 1 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.breakdown).toHaveLength(2);
    expect(perEntry(r.breakdown)).toEqual([0, 1]);
    expect(r.breakdown[0].installments).toEqual([]);
    expect(sumBreakdown(r.breakdown)).toBe(
      sumInstallments(r.view.installments),
    );
  });

  // AC13: a backdated-start clause shows ONE merged grant-date tranche (today's
  // per-clause fold shape), not several relocated rows.
  it("AC13: a backdated start keeps its merged grant-date tranche", () => {
    const r = runEvaluate(
      "VEST FROM DATE 2024-06-01 OVER 12 months EVERY 1 month",
      {
        grant_date: "2025-01-01",
        grant_quantity: 1200,
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.breakdown).toHaveLength(1);
    const inst = r.breakdown[0].installments;
    // Six pre/at-grant occurrences merge to one 700 tranche on the grant date,
    // then five 100s — not eleven separate rows.
    expect(inst.map((i) => (i.state === "RESOLVED" ? i.date : null))).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
      "2025-04-01",
      "2025-05-01",
      "2025-06-01",
    ]);
    expect(inst[0].amount).toBe(700);
    expect(sumBreakdown(r.breakdown)).toBe(
      sumInstallments(r.view.installments),
    );
  });

  // SD6 cross-segment merge: a backdated MULTI-statement THEN chain whose two
  // segments BOTH have pre-grant occurrences. AC13 covers only the single-statement
  // (intra-statement) fold; here the chain-group union must merge BOTH segments'
  // pre-grant rows into ONE grant-date tranche, then keep the post-grant rows in
  // (date, statementOrder, occurrence) order — the SD6 claim a per-member-only
  // coalesce would miss (it would leave two same-date grant tranches).
  it("a backdated multi-statement THEN chain merges both segments to one grant tranche", () => {
    // Segment 1 (2024-06-01 OVER 4): occurrences 2024-07..2024-10, all pre-grant.
    // Segment 2 (handoff 2024-10-01 OVER 4): 2024-11, 2024-12 pre-grant, 2025-01 AT
    // grant, 2025-02 post-grant. Each occurrence is 1/8 of 800 = 100.
    const r = runEvaluate(
      "0.5 VEST FROM DATE 2024-06-01 OVER 4 months EVERY 1 month THEN " +
        "0.5 VEST OVER 4 months EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 800 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // One entry for the whole chain. The grant-date tranche is 700 — segment 1's
    // four pre-grant rows (400) PLUS segment 2's two pre-grant rows and its at-grant
    // row (300). 700 exceeds either segment alone, so it can only come from merging
    // across both members; then the lone post-grant row (2025-02-01) stays separate.
    expect(r.breakdown).toHaveLength(1);
    // The folded 700 line now carries the pre-fold partition (#441): segment 1's
    // four pre-grant rows (2024-07..2024-10) + segment 2's two pre-grant rows
    // (2024-11, 2024-12) + segment 2's native grant-date row (2025-01-01), all @100,
    // Σ === 700 === line.amount — only reachable by merging across both members. The
    // lone post-grant row stays bare.
    expect(r.breakdown[0].installments).toEqual([
      {
        state: "RESOLVED",
        amount: 700,
        date: "2025-01-01",
        scheduled: [
          { scheduledDate: "2024-07-01", amount: 100 },
          { scheduledDate: "2024-08-01", amount: 100 },
          { scheduledDate: "2024-09-01", amount: 100 },
          { scheduledDate: "2024-10-01", amount: 100 },
          { scheduledDate: "2024-11-01", amount: 100 },
          { scheduledDate: "2024-12-01", amount: 100 },
          { scheduledDate: "2025-01-01", amount: 100 },
        ],
      },
      { state: "RESOLVED", amount: 100, date: "2025-02-01" },
    ]);
    expect(sumBreakdown(r.breakdown)).toBe(
      sumInstallments(r.view.installments),
    );
  });

  // AC10: the events/dated arm keys statementOrder in PROGRAM order — a non-dated
  // statement before a dated one keeps the dated statement's program-order key, and
  // the headline byte stream is unchanged from before the re-keying.
  it("AC10: a non-dated clause before a dated one keeps program-order keying", () => {
    const r = runEvaluate(
      "1/2 VEST FROM EVENT ipo OVER 1 month EVERY 1 month PLUS " +
        "1/2 VEST OVER 1 month EVERY 1 month",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Entry 0 (the pending ipo clause) is symbolic; entry 1 (the dated clause) is
    // the dated 50.
    expect(
      r.breakdown[0].installments.every((i) => i.state === "UNRESOLVED"),
    ).toBe(true);
    expect(r.breakdown[1].installments).toEqual([
      { state: "RESOLVED", amount: 50, date: "2025-02-01" },
    ]);
    // Headline byte stream pinned (pre-#442 capture): dated 50 then symbolic 50.
    expect(r.view.installments).toEqual([
      { state: "RESOLVED", amount: 50, date: "2025-02-01" },
      {
        state: "UNRESOLVED",
        amount: 50,
        symbolicDate: { type: "UNRESOLVED_VESTING_START" },
      },
    ]);
    expect(sumBreakdown(r.breakdown)).toBe(
      sumInstallments(r.view.installments),
    );
  });

  // A void dated sibling reaches the events arm when a contingent (event) start
  // forces the program off the template via MULTIPLE_START_ORIGINS — which fires
  // ahead of buildTemplate's cliff-IMPOSSIBLE guard, so the void dated statement
  // never gets poisoned to the unresolved arm. Its IMPOSSIBLE shares must be SHOWN
  // in the headline (the way an all-void program shows its dead shares), never
  // skipped — otherwise the headline drops them while the partition keeps them, and
  // the by-construction tie breaks (the #442 events-arm membership bug). The events
  // arm now splits on `isDated`, agreeing with the partition.
  it("contingent start + a void dated sibling: impossible shares show in the headline and tie", () => {
    const r = runEvaluate(
      "1/2 VEST FROM EVENT ipo OVER 1 month EVERY 1 month PLUS " +
        "1/2 VEST FROM DATE 2025-01-01 OVER 12 months EVERY 1 month " +
        "CLIFF vestingStart + 6 months BEFORE DATE 2020-01-01",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Both clauses are accounted for: 50 pending (clause 1) + 50 impossible
    // (clause 2). The headline is no longer just [UNRESOLVED 50].
    const unresolved = r.view.installments.filter(
      (i) => i.state === "UNRESOLVED",
    );
    const impossible = r.view.installments.filter(
      (i) => i.state === "IMPOSSIBLE",
    );
    expect(sumInstallments(unresolved)).toBe(50);
    expect(sumInstallments(impossible)).toBe(50);
    expect(sumInstallments(r.view.installments)).toBe(100);
    // The partition ties the (now correct) headline, attributing 50 UNRESOLVED to
    // clause 1 and 50 IMPOSSIBLE to clause 2.
    expect(r.breakdown).toHaveLength(2);
    expect(perEntry(r.breakdown)).toEqual([50, 50]);
    expect(
      r.breakdown[0].installments.every((i) => i.state === "UNRESOLVED"),
    ).toBe(true);
    expect(
      r.breakdown[1].installments.every((i) => i.state === "IMPOSSIBLE"),
    ).toBe(true);
    expect(sumBreakdown(r.breakdown)).toBe(
      sumInstallments(r.view.installments),
    );
  });

  // AC14: a blocker-channel failure does NOT sink the amount channel — the
  // breakdown still carries one amount-bearing entry per chain-group (sum ties),
  // and only the blocker lists degrade to empty.
  it("AC14: blocker-channel failure leaves the amount channel intact", () => {
    failClauseBreakdown = true;
    try {
      const r = runEvaluate(
        "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
          "1/3 VEST OVER 1 month EVERY 1 month PLUS " +
          "1/3 VEST OVER 1 month EVERY 1 month",
        { grant_date: "2025-01-01", grant_quantity: 100 },
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // The breakdown is NOT []: one amount-bearing entry per clause, summing to
      // the headline, with empty blocker lists.
      expect(r.breakdown).toHaveLength(3);
      expect(sumBreakdown(r.breakdown)).toBe(
        sumInstallments(r.view.installments),
      );
      for (const entry of r.breakdown) {
        expect(entry.pendingBlockers).toEqual([]);
        expect(entry.deadBlockers).toEqual([]);
      }
    } finally {
      failClauseBreakdown = false;
    }
  });
});

// #441: a backdated start folds its pre-grant rows onto the grant date and the
// breakdown preserves where each would have vested, as a `scheduled` list on the
// folded line. Present iff at least one row was pulled forward; the full partition
// of the line (Σ scheduled.amount === line.amount); no 0-share phantom; never on the
// headline.
describe("runEvaluate — scheduled (pre-fold) dates on the breakdown (#441)", () => {
  // AC1: a single backdated statement folds and carries the full pre-fold partition.
  it("AC1: a backdated start carries the pre-fold scheduled partition", () => {
    const r = runEvaluate(
      "100 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 3 months",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const inst0 = r.breakdown[0].installments[0];
    expect(inst0).toEqual({
      state: "RESOLVED",
      date: "2025-01-01",
      amount: 25,
      scheduled: [
        { scheduledDate: "2024-04-01", amount: 6 },
        { scheduledDate: "2024-07-01", amount: 6 },
        { scheduledDate: "2024-10-01", amount: 6 },
        { scheduledDate: "2025-01-01", amount: 7 },
      ],
    });
    // The list is the full partition of the line.
    if (inst0.state === "RESOLVED" && inst0.scheduled) {
      expect(sumInstallments(inst0.scheduled)).toBe(inst0.amount);
    }
  });

  // AC2: a non-folded line carries no `scheduled` key, and a wholly on-time
  // schedule never carries one anywhere.
  it("AC2: non-folded and wholly on-time lines have no scheduled key", () => {
    const backdated = runEvaluate(
      "100 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 3 months",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(backdated.ok).toBe(true);
    if (!backdated.ok) return;
    // The first on-schedule line after the fold (2025-04-01) is not folded.
    const onSchedule = backdated.breakdown[0].installments[1];
    expect(onSchedule).toEqual({
      state: "RESOLVED",
      amount: 6,
      date: "2025-04-01",
    });
    expect("scheduled" in onSchedule).toBe(false);

    const onTime = runEvaluate(
      "100 VEST FROM DATE 2025-01-01 OVER 48 months EVERY 3 months",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(onTime.ok).toBe(true);
    if (!onTime.ok) return;
    for (const entry of onTime.breakdown) {
      for (const inst of entry.installments) {
        expect("scheduled" in inst).toBe(false);
      }
    }
  });

  // AC3: a contribution that floored to 0 never appears in a populated list, and a
  // wholly-elided catch-up emits no `scheduled` key at all.
  it("AC3: a dropped 0-row never sneaks into a populated scheduled list", () => {
    const seven = runEvaluate(
      "7 VEST FROM DATE 2024-01-01 OVER 48 months EVERY 3 months",
      { grant_date: "2025-01-01", grant_quantity: 7 },
    );
    expect(seven.ok).toBe(true);
    if (!seven.ok) return;
    const folded = seven.breakdown[0].installments[0];
    // Only the surviving 2024-10-01 row folds forward — no phantom 2024-04-01 /
    // 2024-07-01 / 2025-01-01 rows that floored to 0.
    expect(folded).toEqual({
      state: "RESOLVED",
      date: "2025-01-01",
      amount: 1,
      scheduled: [{ scheduledDate: "2024-10-01", amount: 1 }],
    });
    if (folded.state === "RESOLVED" && folded.scheduled) {
      // Σ ties the line AND no entry is a 0-share phantom (the Σ check alone would
      // not catch one, since adding 0 leaves the sum unchanged).
      expect(sumInstallments(folded.scheduled)).toBe(folded.amount);
      expect(folded.scheduled.every((s) => s.amount !== 0)).toBe(true);
    }

    // The fully-elided case: the whole 2024 catch-up floors to 0, so there is no
    // grant-date tranche and no `scheduled` key anywhere.
    const three = runEvaluate(
      "VEST FROM DATE 2024-01-01 OVER 48 months EVERY 3 months",
      { grant_date: "2025-01-01", grant_quantity: 3 },
    );
    expect(three.ok).toBe(true);
    if (!three.ok) return;
    for (const entry of three.breakdown) {
      for (const inst of entry.installments) {
        expect("scheduled" in inst).toBe(false);
      }
    }
  });

  // AC4: a backdated portioned THEN chain merges both segments' pre-grant rows into
  // one grant-date line after the pipeline rollup (the Point-1 → Point-2 merge).
  it("AC4: a THEN chain re-coalesce preserves scheduled across the rollup", () => {
    const r = runEvaluate(
      "0.5 VEST FROM DATE 2024-01-01 OVER 6 months EVERY 3 months THEN " +
        "0.5 VEST OVER 6 months EVERY 3 months",
      { grant_date: "2025-01-01", grant_quantity: 100 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.breakdown).toHaveLength(1);
    const line = r.breakdown[0].installments[0];
    expect(line.state).toBe("RESOLVED");
    // Assert presence before the narrowing guard, so a regression that dropped
    // `scheduled` fails here rather than short-circuiting to a vacuous pass.
    expect(line.state === "RESOLVED" && "scheduled" in line).toBe(true);
    if (line.state !== "RESOLVED" || !line.scheduled) return;
    // The head's two pre-grant occurrences + the tail's pre-grant occurrence + the
    // tail's native grant-date occurrence — the merged dates, globally ascending.
    expect(line.scheduled.map((s) => s.scheduledDate)).toEqual([
      "2024-04-01",
      "2024-07-01",
      "2024-10-01",
      "2025-01-01",
    ]);
    expect(sumInstallments(line.scheduled)).toBe(line.amount);
    expect(line.amount).toBe(100);
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
    expect(r.view.storable.status).toBe("template");
  });
});

// #412: a THEN tail behind a head whose grid is held on an unfired event cliff is
// not storable — canonical can't hold a fixed-date tail whose start waits on an
// event. The storable verdict is unrepresentable, so `representable` reads false.
describe("runEvaluate — a held-cliff head's THEN tail is not representable (#412)", () => {
  it("reports unrepresentable / representable=false", () => {
    const r = runEvaluate(
      "1/2 VEST OVER 4 months EVERY 1 month CLIFF EVENT ipo " +
        "THEN 1/2 VEST OVER 4 months EVERY 1 month",
      { grant_date: "2024-01-01", grant_quantity: 800 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.storable.status).toBe("unrepresentable");
    expect(r.view.representable).toBe(false);
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
    expect(r.view.storable.status).toBe("template");
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
