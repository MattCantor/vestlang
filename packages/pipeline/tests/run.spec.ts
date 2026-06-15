import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runEvaluate,
  runAsOf,
  runVestedBetween,
  type GrantInput,
  type Summary,
} from "../src/index";

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

// R2-B3: a pending-head chain with a tail event cliff must report the cliff
// (permanent — no schema home), not the chain (temporary — undated until firing).
describe("runEvaluate — pending-head chain with a tail event cliff (R2-B3)", () => {
  it("names the cliff's event in the storable reason", () => {
    const r = runEvaluate(
      "1/2 VEST FROM EVENT ipo OVER 12 months EVERY 1 month " +
        "THEN 1/2 VEST OVER 12 months EVERY 1 month CLIFF EVENT fda",
      { grant_date: "2025-01-01", grant_quantity: 2400 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.interchange.status).toBe("unrepresentable");
    if (r.view.interchange.status !== "unrepresentable") return;
    expect(r.view.interchange.reason).toBe(
      'Event-anchored cliff on "fda" has no template form.',
    );
  });
});

// R2-B14: a gated event cliff is as unstorable as a bare one — the reason must
// name the event (permanent, no schema home), not claim the schedule merely
// "can't be stored ahead of time".
describe("runEvaluate — gated event cliff keeps its EVENT identity (R2-B14)", () => {
  it("names the cliff's event in the storable reason", () => {
    const r = runEvaluate(
      "VEST OVER 48 months EVERY 1 month CLIFF EVENT ipo AFTER DATE 2025-01-01",
      { grant_date: "2024-01-01", grant_quantity: 48 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.view.interchange.status).toBe("unrepresentable");
    if (r.view.interchange.status !== "unrepresentable") return;
    expect(r.view.interchange.reason).toBe(
      'Event-anchored cliff on "ipo" has no template form.',
    );
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
